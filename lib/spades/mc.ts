import { Card, RNG, Seat, makeRng, suitOf, teamOf } from './cards';
import { TrickCard, legalMoves, winningIndex } from './rules';
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
  /**
   * Tricks this side ends up winning in each suit, credited to the suit of the
   * card that won them. Lets the coach answer "does leading this suit actually
   * bring in the tricks I am hoping for?" rather than only comparing totals.
   */
  suitTricks: number[];
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
export function evaluatePlays(
  ctx: EvalContext,
  samples: number,
  seed = 12345,
  only?: Card[]
): EvalResult {
  const { info } = ctx;
  const all = legalMoves(info.hand, ctx.trick, ctx.spadesBroken);
  const keep = only ? new Set(only) : null;
  const legal = keep ? all.filter((c) => keep.has(c)) : all;
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
  const sumSuitTricks = new Float64Array(n * 4);
  const creditTeam = (winner: Seat) => teamOf(winner) === team;
  const suitScratch = [0, 0, 0, 0];

  for (let s = 0; s < samples; s++) {
    const layout = dealUnseen(info, rng);
    for (let k = 0; k < n; k++) {
      const st = stateFrom(ctx, [
        layout[0].slice(),
        layout[1].slice(),
        layout[2].slice(),
        layout[3].slice(),
      ]);
      // The card being judged is credited too, so the totals cover the whole hand.
      suitScratch[0] = suitScratch[1] = suitScratch[2] = suitScratch[3] = 0;
      const played = legal[k];
      const trickBefore = st.trick.slice();
      const actor = st.turn;
      applyCard(st, played);
      if (st.trick.length === 0) {
        const full: TrickCard[] = [...trickBefore, { seat: actor, card: played }];
        const w = full[winningIndex(full)];
        if (creditTeam(w.seat)) suitScratch[suitOf(w.card)]++;
      }
      playoutAttributed(st, creditTeam, suitScratch);
      for (let u = 0; u < 4; u++) sumSuitTricks[k * 4 + u] += suitScratch[u];
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
      suitTricks: [0, 1, 2, 3].map((u) => sumSuitTricks[k * 4 + u] / samples),
      samples,
    });
  }
  candidates.sort((a, b) => b.ev - a.ev);
  return { candidates, samples, utilities, rowOf };
}

/**
 * How many standard errors a gap must clear before one play is called better
 * than another.
 *
 * 1.96 is the usual 95% figure and it is the wrong one wherever the card being
 * compared was not chosen in advance - and in a short list it never is, it is
 * the best-looking of five. Test the winner of five comparisons at 95% and the
 * whole set is wrong about one time in five. Spreading that same 95% across
 * five looks gives 2.58.
 *
 * The coach also splits its deals so the claim is confirmed on samples it was
 * not chosen on, which removes that bias outright rather than budgeting for it.
 * Keeping the wider bar on top of the split is deliberate: a trainer that says
 * nothing costs the player nothing, and one that says the wrong thing does.
 */
export const CONFIDENCE_Z = 2.58;

/** The gap two plays must show before the difference is worth mentioning. */
export const NOISE_FLOOR = 0.1;

export interface RunoffOptions {
  /** First round, spent across every legal card. */
  samples: number;
  /** Second round, spent only on the cards still in contention. */
  runoff: number;
  /** How many cards reach the second round. */
  finalists?: number;
  /** Cards that must reach the second round whatever the first round said. */
  include?: Card[];
  seed?: number;
}

/**
 * Two rounds, so the answer is not the argmax of a dozen noisy numbers.
 *
 * Ranking N candidates by N independent estimates has a bias nobody expects the
 * first time they meet it: the top row is the one whose sampling error happened
 * to be most flattering, so it is both wrong more often than the error bars
 * suggest and reported too high. With a live nil at the table the swing on a
 * single deal is ten times the difference between two sensible discards, and
 * that bias is the whole ranking.
 *
 * The cure is to stop spreading the budget evenly. A cheap first round only has
 * to answer "which cards are still in this?", and the cards it eliminates were
 * beaten by more than the noise. Everything saved on them is then spent on the
 * short list, where the differences are small enough to need it.
 */
export function evaluateWithRunoff(ctx: EvalContext, opts: RunoffOptions): EvalResult {
  const seed = opts.seed ?? 12345;
  const first = evaluatePlays(ctx, opts.samples, seed);
  const cap = Math.max(2, opts.finalists ?? 4);
  if (first.candidates.length < 2) return first;

  const leader = first.candidates[0].card;
  const contenders: Card[] = [];
  for (const c of first.candidates) {
    if (c.card === leader) {
      contenders.push(c.card);
      continue;
    }
    if (contenders.length >= cap) break;
    // Keep anything the first round could not prove worse than the leader.
    const d = pairedDifference(first, leader, c.card);
    if (d.mean <= Math.max(NOISE_FLOOR, CONFIDENCE_Z * d.stdError)) contenders.push(c.card);
  }
  for (const c of opts.include ?? []) {
    if (!contenders.includes(c) && first.rowOf.has(c)) contenders.push(c);
  }
  if (contenders.length < 2) contenders.push(first.candidates[1].card);
  if (contenders.length === first.candidates.length && opts.runoff <= opts.samples) return first;

  const second = evaluatePlays(ctx, opts.runoff, seed + 1, contenders);
  const inRunoff = new Set(contenders);
  // Cards knocked out in the first round keep their coarse numbers and stay
  // below the finalists: they were measured less carefully, so letting a stale
  // estimate jump back to the top is exactly the error this is here to avoid.
  const eliminated = first.candidates.filter((c) => !inRunoff.has(c.card));
  return {
    candidates: [...second.candidates, ...eliminated],
    samples: second.samples,
    utilities: second.utilities,
    rowOf: second.rowOf,
  };
}

/**
 * Mean and standard error of (value of A minus value of B) over the shared
 * samples. Used so the coach never grades a gap smaller than its own noise.
 */
export function pairedDifference(
  res: EvalResult,
  cardA: Card,
  cardB: Card,
  window?: { from: number; to: number }
): { mean: number; stdError: number } {
  const ia = res.rowOf.get(cardA);
  const ib = res.rowOf.get(cardB);
  if (ia === undefined || ib === undefined || res.samples === 0) return { mean: 0, stdError: 0 };
  const n = res.samples;
  const from = Math.max(0, window?.from ?? 0);
  const to = Math.min(n, window?.to ?? n);
  const count = to - from;
  if (count <= 1) return { mean: 0, stdError: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let s = from; s < to; s++) {
    const d = res.utilities[ia * n + s] - res.utilities[ib * n + s];
    sum += d;
    sumSq += d * d;
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return { mean, stdError: Math.sqrt(variance / count) };
}

/**
 * The two halves of a run: one to choose a claim on, one to test it on.
 *
 * Choosing the best-looking card and then testing it against the very samples
 * that made it look best is the oldest way there is to find an effect that is
 * not there. The deals are independent, so splitting them costs nothing but
 * precision, and what comes back the other side is an honest test of a claim
 * that was fixed before those deals were looked at.
 */
export function selectionHalf(res: EvalResult): { from: number; to: number } {
  return { from: 0, to: Math.floor(res.samples / 2) };
}
export function confirmationHalf(res: EvalResult): { from: number; to: number } {
  return { from: Math.floor(res.samples / 2), to: res.samples };
}

// ------------------------------------------------------------- bid support --

export interface TrickEstimate {
  expected: number;
  /** Probability of taking exactly i tricks. */
  distribution: number[];
  nilProb: number;
  samples: number;
  /**
   * Average tricks won where the *winning* card was of that suit. This is the
   * breakdown a player counts in, and it is what makes long side suits look as
   * weak as they really are: seven diamonds do not produce seven diamond tricks.
   */
  bySuit: number[];
  /** Tricks won by trumping a suit you were out of. A subset of the spade total. */
  ruffs: number;
  /** How many cards the hand holds in each suit, for side-by-side comparison. */
  lengths: number[];
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
  const bySuit = [0, 0, 0, 0];
  let ruffs = 0;
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
    ruffs += playoutAttributed(st, (w) => w === seat, bySuit);
    const t = st.tricksWon[seat];
    distribution[t]++;
    total += t;
  }

  const lengths = [0, 0, 0, 0];
  for (const c of hand) lengths[suitOf(c)]++;

  return {
    expected: total / samples,
    distribution: distribution.map((d) => d / samples),
    nilProb: distribution[0] / samples,
    samples,
    bySuit: bySuit.map((n) => n / samples),
    ruffs: ruffs / samples,
    lengths,
  };
}

/**
 * Plays a hand out, recording which suit actually won each trick for `seat`.
 * Returns the number of those tricks that were ruffs.
 */
function playoutAttributed(
  st: PlayState,
  credit: (winner: Seat) => boolean,
  bySuit: number[]
): number {
  let ruffs = 0;
  let guard = 0;
  while (!isTerminal(st) && guard++ < 64) {
    const actor = st.turn;
    const before = st.trick.slice();
    const card = heuristicChoice(st);
    applyCard(st, card);
    // applyCard clears the trick the moment the fourth card lands, so an empty
    // trick here means the one we just completed has been resolved.
    if (st.trick.length === 0) {
      const full: TrickCard[] = [...before, { seat: actor, card }];
      const winner = full[winningIndex(full)];
      if (credit(winner.seat)) {
        const winSuit = suitOf(winner.card);
        bySuit[winSuit]++;
        if (winSuit === 3 && suitOf(full[0].card) !== 3) ruffs++;
      }
    }
  }
  return ruffs;
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
