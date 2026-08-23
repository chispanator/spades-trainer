import { Card, RNG, Seat, makeRng, suitOf, teamOf } from './cards';
import { TrickCard, legalMoves } from './rules';
import { InfoSet, dealUnseen, emptyVoids } from './inference';
import { PlayState, applyCard, isTerminal, outcomeOf, terminalUtility } from './playstate';
import { heuristicChoice } from './policy';

export interface EvalContext {
  info: InfoSet;
  bids: number[];
  trick: TrickCard[];
  tricksWon: number[];
  spadesBroken: boolean;
  bagsBefore: [number, number];
}

export interface CandidateEval {
  card: Card;
  /** Expected value in points; one point is ten spades score points. */
  ev: number;
  /** Probability the observer's side makes its contract, including any nil. */
  makeProb: number;
  /** Probability the opposing side is set. */
  setProb: number;
  avgTeamTricks: number;
  avgBags: number;
  avgScore: number;
  samples: number;
}

export interface EvalResult {
  /** Sorted best first. */
  candidates: CandidateEval[];
  samples: number;
  /** Per-sample utilities, candidate-major, kept for paired statistics. */
  utilities: Float64Array;
  rowOf: Map<Card, number>;
}

function playout(st: PlayState): void {
  let guard = 0;
  while (!isTerminal(st) && guard++ < 64) {
    applyCard(st, heuristicChoice(st));
  }
}

function stateFrom(ctx: EvalContext, hands: Card[][]): PlayState {
  return {
    hands,
    bids: ctx.bids,
    turn: ctx.info.observer,
    trick: ctx.trick.slice(),
    spadesBroken: ctx.spadesBroken,
    tricksWon: ctx.tricksWon.slice(),
    bagsBefore: ctx.bagsBefore,
  };
}

/**
 * Perfect-Information Monte Carlo. Every sample deals the unseen cards into a
 * layout consistent with what has been shown, then tries each candidate card
 * against that same layout (common random numbers). Pairing the samples makes a
 * comparison between two cards far less noisy than evaluating each separately.
 */
export function evaluatePlays(ctx: EvalContext, samples: number, seed = 12345): EvalResult {
  const { info } = ctx;
  const legal = legalMoves(info.hand, ctx.trick, ctx.spadesBroken);
  const team = teamOf(info.observer);
  const opp = (team === 0 ? 1 : 0) as 0 | 1;
  const rng: RNG = makeRng(seed);

  const n = legal.length;
  const utilities = new Float64Array(n * samples);
  const rowOf = new Map<Card, number>();
  if (n === 0) return { candidates: [], samples, utilities, rowOf };

  const sumTricks = new Float64Array(n);
  const sumBags = new Float64Array(n);
  const sumScore = new Float64Array(n);
  const madeCount = new Float64Array(n);
  const setCount = new Float64Array(n);

  for (let s = 0; s < samples; s++) {
    const layout = dealUnseen(info, rng);
    for (let k = 0; k < n; k++) {
      const st = stateFrom(ctx, [
        layout[0].slice(),
        layout[1].slice(),
        layout[2].slice(),
        layout[3].slice(),
      ]);
      applyCard(st, legal[k]);
      playout(st);
      utilities[k * samples + s] = terminalUtility(st, team);
      const o = outcomeOf(st);
      sumTricks[k] += o.teamTricks[team];
      sumBags[k] += o.teamBags[team];
      sumScore[k] += o.teamScore[team];
      if (o.made[team]) madeCount[k]++;
      if (!o.made[opp]) setCount[k]++;
    }
  }

  const candidates: CandidateEval[] = [];
  for (let k = 0; k < n; k++) {
    rowOf.set(legal[k], k);
    let sum = 0;
    for (let s = 0; s < samples; s++) sum += utilities[k * samples + s];
    candidates.push({
      card: legal[k],
      ev: sum / samples,
      makeProb: madeCount[k] / samples,
      setProb: setCount[k] / samples,
      avgTeamTricks: sumTricks[k] / samples,
      avgBags: sumBags[k] / samples,
      avgScore: sumScore[k] / samples,
      samples,
    });
  }
  candidates.sort((a, b) => b.ev - a.ev);
  return { candidates, samples, utilities, rowOf };
}

/**
 * Mean and standard error of (value of A minus value of B) over the shared
 * samples. Used so the coach never grades a gap smaller than its own noise.
 */
export function pairedDifference(
  res: EvalResult,
  cardA: Card,
  cardB: Card
): { mean: number; stdError: number } {
  const ia = res.rowOf.get(cardA);
  const ib = res.rowOf.get(cardB);
  if (ia === undefined || ib === undefined || res.samples === 0) return { mean: 0, stdError: 0 };
  const n = res.samples;
  let sum = 0;
  let sumSq = 0;
  for (let s = 0; s < n; s++) {
    const d = res.utilities[ia * n + s] - res.utilities[ib * n + s];
    sum += d;
    sumSq += d * d;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, stdError: Math.sqrt(variance / n) };
}

// ------------------------------------------------------------- bid support --

export interface TrickEstimate {
  expected: number;
  /** Probability of taking exactly i tricks. */
  distribution: number[];
  nilProb: number;
  samples: number;
}

/**
 * Expected tricks for a full 13-card hand before any card is played. Every seat
 * gets a provisional high bid so nobody ducks in the simulation: the answer is
 * "tricks this hand takes when all four seats are trying".
 */
export function estimateTricks(
  hand: Card[],
  seat: Seat,
  leader: Seat,
  samples: number,
  seed = 999
): TrickEstimate {
  const rng = makeRng(seed);
  const unseen: Card[] = [];
  const inHand = new Set(hand);
  for (let c = 0; c < 52; c++) if (!inHand.has(c)) unseen.push(c);

  const info: InfoSet = {
    observer: seat,
    hand,
    handSizes: [13, 13, 13, 13],
    voids: emptyVoids(),
    unseen,
  };

  const bids = [6, 6, 6, 6];
  const distribution = new Array(14).fill(0);
  let total = 0;

  for (let s = 0; s < samples; s++) {
    const layout = dealUnseen(info, rng);
    const st: PlayState = {
      hands: layout,
      bids,
      turn: leader,
      trick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      bagsBefore: [0, 0],
    };
    playout(st);
    const t = st.tricksWon[seat];
    distribution[t]++;
    total += t;
  }

  return {
    expected: total / samples,
    distribution: distribution.map((d) => d / samples),
    nilProb: distribution[0] / samples,
    samples,
  };
}

/** Classic hand count, used to put a bid into words alongside the simulation. */
export interface BidBreakdown {
  lines: { label: string; value: number }[];
  total: number;
}

export function bidBreakdown(hand: Card[]): BidBreakdown {
  const bySuit: Card[][] = [[], [], [], []];
  for (const c of hand) bySuit[suitOf(c)].push(c);
  const rank = (c: Card) => c % 13;

  const lines: { label: string; value: number }[] = [];
  const spades = bySuit[3];
  const hasSpade = (r: number) => spades.some((c) => rank(c) === r);

  let spadeTricks = 0;
  if (hasSpade(12)) spadeTricks += 1;
  if (hasSpade(11)) spadeTricks += spades.length >= 2 ? 1 : 0.5;
  if (hasSpade(10)) spadeTricks += spades.length >= 3 ? 1 : 0.5;
  if (spades.length > 4) spadeTricks += spades.length - 4;
  if (spadeTricks > 0) {
    lines.push({ label: `Spade honours and length (${spades.length} spades)`, value: spadeTricks });
  }

  let sideTricks = 0;
  const SIDE_NAME = ['clubs', 'diamonds', 'hearts'];
  for (let s = 0; s < 3; s++) {
    const g = bySuit[s];
    let v = 0;
    if (g.some((c) => rank(c) === 12)) v += 1;
    if (g.some((c) => rank(c) === 11)) v += g.length >= 2 ? 0.7 : 0.25;
    if (g.some((c) => rank(c) === 10) && g.length >= 3) v += 0.3;
    if (v > 0) lines.push({ label: `High ${SIDE_NAME[s]}`, value: v });
    sideTricks += v;
  }

  let shape = 0;
  for (let s = 0; s < 3; s++) {
    if (bySuit[s].length === 0 && spades.length >= 3) shape += 1;
    else if (bySuit[s].length === 1 && spades.length >= 3) shape += 0.5;
  }
  if (shape > 0) lines.push({ label: 'Ruffing value from short suits', value: shape });

  return { lines, total: spadeTricks + sideTricks + shape };
}
