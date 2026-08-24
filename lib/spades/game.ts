import {
  Card,
  Seat,
  dealDeck,
  makeRng,
  nextSeat,
  partnerOf,
  suitOf,
  teamOf,
} from './cards';
import { TEAM_SEATS, TrickCard, legalMoves, scoreTeamHand, trickWinner } from './rules';
import { PlayState } from './playstate';
import { heuristicChoice } from './policy';
import { InfoSet, deriveVoids } from './inference';
import {
  CONFIDENCE_Z,
  NOISE_FLOOR,
  bidBreakdown,
  estimateTricks,
  evaluatePlays,
  EvalResult,
  evaluateWithRunoff,
  pairedDifference,
} from './mc';
import { preferAmongEquals } from './judgment';
import { BidReview, PlayReview, PlaySituation, reviewBid, reviewPlay } from './coach';

export type Phase = 'bidding' | 'playing' | 'trickComplete' | 'handComplete' | 'gameComplete';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

/** Simulations the opponents use per decision. Beginner plays by rule of thumb. */
const AI_SAMPLES: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 80,
  advanced: 250,
};
const AI_BID_SAMPLES: Record<Difficulty, number> = {
  beginner: 40,
  intermediate: 120,
  advanced: 250,
};
/**
 * Simulations behind the feedback the player sees, in two rounds.
 *
 * Dividing a fixed budget by the number of legal cards is the obvious way to
 * hold the cost of a decision steady, and it is backwards: the more cards there
 * are, the more chances noise has to float one of them to the top, so the
 * hardest decisions were being given the loosest error bars. Twelve legal cards
 * bought 750 deals each, and with a nil live at the table the swing on a single
 * deal is ten times the gap between two sensible discards.
 *
 * So the first round is deliberately cheap and only has to answer which cards
 * are still in contention, and the budget that used to be spread across all of
 * them goes to the few that survive.
 */
export function coachSamples(choices: number): number {
  return Math.max(250, Math.min(600, Math.round(3600 / Math.max(1, choices))));
}
/**
 * The short list, and what is spent on it. Five is where the sweep in
 * scripts/selftest.ts settled: below it the genuinely best card starts falling
 * out of the first round, and above it the extra deals buy nothing.
 */
export const COACH_RUNOFF = 1800;
export const COACH_FINALISTS = 5;
/** Simulations behind the live hint button, which should feel instant. */
export function hintSamples(choices: number): number {
  return Math.max(250, Math.min(1200, Math.round(4000 / Math.max(1, choices))));
}
export const BID_SAMPLES = 800;

export const HUMAN: Seat = 0;

export interface HandResult {
  handNumber: number;
  bids: number[];
  tricksWon: number[];
  handScore: [number, number];
  bagsEarned: [number, number];
  totals: [number, number];
  madeContract: [boolean, boolean];
  reviews: PlayReview[];
  bidReview: BidReview | null;
}

export interface GameOptions {
  seed: number;
  targetScore: number;
  difficulty: Difficulty;
  allowNil: boolean;
}

export interface GameState {
  options: GameOptions;
  handNumber: number;
  dealer: Seat;
  hands: Card[][];
  bids: (number | null)[];
  phase: Phase;
  turn: Seat;
  trick: TrickCard[];
  trickWinnerSeat: Seat | null;
  completedTricks: { cards: TrickCard[]; winner: Seat }[];
  tricksWon: number[];
  spadesBroken: boolean;
  scores: [number, number];
  bags: [number, number];
  reviews: PlayReview[];
  bidReview: BidReview | null;
  history: HandResult[];
  lastHand: HandResult | null;
}

function clone(g: GameState): GameState {
  return {
    ...g,
    hands: g.hands.map((h) => h.slice()),
    bids: g.bids.slice(),
    trick: g.trick.slice(),
    completedTricks: g.completedTricks.map((t) => ({ cards: t.cards.slice(), winner: t.winner })),
    tricksWon: g.tricksWon.slice(),
    scores: [...g.scores] as [number, number],
    bags: [...g.bags] as [number, number],
    reviews: g.reviews.slice(),
    history: g.history.slice(),
  };
}

export function newGame(options: GameOptions): GameState {
  const base: GameState = {
    options,
    handNumber: 0,
    dealer: 3,
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    phase: 'bidding',
    turn: 0,
    trick: [],
    trickWinnerSeat: null,
    completedTricks: [],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    scores: [0, 0],
    bags: [0, 0],
    reviews: [],
    bidReview: null,
    history: [],
    lastHand: null,
  };
  return dealNextHand(base);
}

export function dealNextHand(g: GameState): GameState {
  const n = clone(g);
  n.handNumber = g.handNumber + 1;
  n.dealer = g.handNumber === 0 ? 3 : nextSeat(g.dealer);
  n.hands = dealDeck(makeRng(g.options.seed + n.handNumber * 7919));
  n.bids = [null, null, null, null];
  n.phase = 'bidding';
  n.turn = nextSeat(n.dealer);
  n.trick = [];
  n.trickWinnerSeat = null;
  n.completedTricks = [];
  n.tricksWon = [0, 0, 0, 0];
  n.spadesBroken = false;
  n.reviews = [];
  n.bidReview = null;
  n.lastHand = null;
  return n;
}

// ------------------------------------------------------------------ bidding --

export function submitBid(g: GameState, seat: Seat, bid: number): GameState {
  const n = clone(g);
  n.bids[seat] = bid;
  if (n.bids.every((b) => b !== null)) {
    n.phase = 'playing';
    n.turn = nextSeat(n.dealer);
  } else {
    n.turn = nextSeat(seat);
  }
  return n;
}

export function aiBid(g: GameState, seat: Seat): number {
  const leader = nextSeat(g.dealer);
  const est = estimateTricks(
    g.hands[seat],
    seat,
    leader,
    AI_BID_SAMPLES[g.options.difficulty],
    g.options.seed + g.handNumber * 131 + seat
  );
  if (g.options.allowNil && est.nilProb >= 0.6 && est.expected < 0.8) return 0;

  let bid = Math.round(est.expected);
  // A partner who has already bid big means the team should not overreach.
  const p = partnerOf(seat);
  const partnerBid = g.bids[p];
  if (partnerBid !== null && partnerBid > 0 && partnerBid + bid > 9) bid = Math.max(1, 9 - partnerBid);
  return Math.max(1, Math.min(13, bid));
}

// ------------------------------------------------------------------ playing --

export function buildInfoSet(g: GameState, seat: Seat): InfoSet {
  const seen = new Set<Card>(g.hands[seat]);
  for (const t of g.completedTricks) for (const tc of t.cards) seen.add(tc.card);
  for (const tc of g.trick) seen.add(tc.card);
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
  return {
    observer: seat,
    hand: g.hands[seat].slice(),
    handSizes: [0, 1, 2, 3].map((s) => g.hands[s].length),
    voids: deriveVoids([...g.completedTricks.map((t) => t.cards), g.trick]),
    unseen,
  };
}

function numericBids(g: GameState): number[] {
  return g.bids.map((b) => (b === null ? 3 : b));
}

function decisionSeed(g: GameState, seat: Seat): number {
  return g.options.seed + g.handNumber * 7717 + g.completedTricks.length * 61 + g.trick.length * 7 + seat;
}

export function evaluateFor(g: GameState, seat: Seat, samples: number) {
  return evaluatePlays(
    {
      info: buildInfoSet(g, seat),
      bids: numericBids(g),
      trick: g.trick,
      tricksWon: g.tricksWon,
      spadesBroken: g.spadesBroken,
      bagsBefore: g.bags,
    },
    samples,
    decisionSeed(g, seat)
  );
}

export function legalFor(g: GameState, seat: Seat): Card[] {
  return legalMoves(g.hands[seat], g.trick, g.spadesBroken);
}

export function aiChooseCard(g: GameState, seat: Seat): Card {
  const legal = legalFor(g, seat);
  if (legal.length === 1) return legal[0];
  const samples = AI_SAMPLES[g.options.difficulty];
  if (samples === 0) {
    const st: PlayState = {
      hands: g.hands.map((h) => h.slice()),
      bids: numericBids(g),
      turn: seat,
      trick: g.trick.slice(),
      spadesBroken: g.spadesBroken,
      tricksWon: g.tricksWon.slice(),
      bagsBefore: g.bags,
    };
    return heuristicChoice(st);
  }
  return bestPlay(g, seat, evaluateFor(g, seat, samples));
}

/**
 * The card to play out of a finished evaluation.
 *
 * Not `candidates[0]`: the top row of a ranking is only as meaningful as the
 * gap beneath it, and inside the margin of error there is no gap - only the
 * candidate whose sampling error happened to flatter it most. Everything the
 * simulation cannot separate is handed to judgment.ts, which breaks the tie on
 * what the cards are worth rather than on which random deals came up.
 */
export function bestPlay(g: GameState, seat: Seat, res: EvalResult): Card {
  if (!res.candidates.length) return legalFor(g, seat)[0];
  const leader = res.candidates[0];
  const tied = res.candidates
    .filter((c) => {
      if (c.card === leader.card) return true;
      const d = pairedDifference(res, leader.card, c.card);
      return d.mean <= Math.max(NOISE_FLOOR, CONFIDENCE_Z * d.stdError);
    })
    .map((c) => c.card);
  if (tied.length < 2) return leader.card;
  return preferAmongEquals(tied, {
    seat,
    hand: g.hands[seat],
    bids: numericBids(g),
    unseen: buildInfoSet(g, seat).unseen,
  });
}

/** Grades the human's card against the position it was played into. */
export function reviewHumanPlay(g: GameState, card: Card): PlayReview {
  const info = buildInfoSet(g, HUMAN);
  const sit: PlaySituation = {
    seat: HUMAN,
    hand: g.hands[HUMAN].slice(),
    trick: g.trick.slice(),
    bids: numericBids(g),
    tricksWon: g.tricksWon.slice(),
    spadesBroken: g.spadesBroken,
    trickNumber: g.completedTricks.length + 1,
    unseen: info.unseen,
  };
  const res = evaluateWithRunoff(
    {
      info,
      bids: numericBids(g),
      trick: g.trick,
      tricksWon: g.tricksWon,
      spadesBroken: g.spadesBroken,
      bagsBefore: g.bags,
    },
    {
      samples: coachSamples(legalFor(g, HUMAN).length),
      runoff: COACH_RUNOFF,
      finalists: COACH_FINALISTS,
      // The card actually played always gets the careful measurement, so the
      // grade never rests on the coarse first round.
      include: [card],
      seed: decisionSeed(g, HUMAN),
    }
  );
  return reviewPlay(sit, card, res);
}

export function playCard(g: GameState, card: Card, review?: PlayReview): GameState {
  const n = clone(g);
  const seat = n.turn;
  const hand = n.hands[seat];
  const idx = hand.indexOf(card);
  if (idx < 0) return g;
  hand.splice(idx, 1);
  if (suitOf(card) === 3) n.spadesBroken = true;
  n.trick = [...n.trick, { seat, card }];
  if (review) n.reviews = [...n.reviews, review];

  if (n.trick.length === 4) {
    n.trickWinnerSeat = trickWinner(n.trick);
    n.phase = 'trickComplete';
  } else {
    n.turn = nextSeat(seat);
  }
  return n;
}

/** Clears a finished trick. Kept separate so the table can hold it on screen. */
export function resolveTrick(g: GameState): GameState {
  if (g.phase !== 'trickComplete' || g.trickWinnerSeat === null) return g;
  const n = clone(g);
  const winner = g.trickWinnerSeat;
  n.tricksWon[winner]++;
  n.completedTricks = [...n.completedTricks, { cards: g.trick.slice(), winner }];
  n.trick = [];
  n.trickWinnerSeat = null;
  n.turn = winner;
  n.phase = 'playing';
  if (n.hands.every((h) => h.length === 0)) return finishHand(n);
  return n;
}

function finishHand(g: GameState): GameState {
  const n = clone(g);
  const bids = numericBids(n);
  const a = scoreTeamHand(TEAM_SEATS[0], bids, n.tricksWon, n.bags[0]);
  const b = scoreTeamHand(TEAM_SEATS[1], bids, n.tricksWon, n.bags[1]);

  n.scores = [n.scores[0] + a.score, n.scores[1] + b.score];
  n.bags = [a.bagsAfter, b.bagsAfter];

  const result: HandResult = {
    handNumber: n.handNumber,
    bids,
    tricksWon: n.tricksWon.slice(),
    handScore: [a.score, b.score],
    bagsEarned: [a.bagsEarned, b.bagsEarned],
    totals: [n.scores[0], n.scores[1]],
    madeContract: [
      a.madeContract && a.nilResults.every((r) => r.made),
      b.madeContract && b.nilResults.every((r) => r.made),
    ],
    reviews: n.reviews.slice(),
    bidReview: n.bidReview,
  };
  n.history = [...n.history, result];
  n.lastHand = result;

  const target = n.options.targetScore;
  const done =
    (n.scores[0] >= target || n.scores[1] >= target) && n.scores[0] !== n.scores[1];
  n.phase = done ? 'gameComplete' : 'handComplete';
  return n;
}

// -------------------------------------------------------------- bid review --

/** What the simulation thinks this hand is worth, before any bid is made. */
export function bidEstimate(g: GameState, seat: Seat = HUMAN) {
  return estimateTricks(
    g.hands[seat],
    seat,
    nextSeat(g.dealer),
    BID_SAMPLES,
    g.options.seed + g.handNumber * 313 + seat
  );
}

export function reviewHumanBid(g: GameState, bid: number): BidReview {
  return reviewBid(
    bid,
    g.hands[HUMAN],
    bidEstimate(g, HUMAN),
    bidBreakdown(g.hands[HUMAN]),
    g.bids[partnerOf(HUMAN)]
  );
}

export function attachBidReview(g: GameState, review: BidReview): GameState {
  const n = clone(g);
  n.bidReview = review;
  return n;
}

// ------------------------------------------------------------------ summary --

export interface SessionStats {
  counts: Record<string, number>;
  totalDecisions: number;
  totalLoss: number;
  accuracy: number;
}

export function sessionStats(reviews: PlayReview[]): SessionStats {
  const counts: Record<string, number> = {
    optimal: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  let totalLoss = 0;
  let decisions = 0;
  for (const r of reviews) {
    if (!r.hadChoice) continue;
    counts[r.grade]++;
    totalLoss += r.loss;
    decisions++;
  }
  return {
    counts,
    totalDecisions: decisions,
    totalLoss,
    accuracy: decisions ? (counts.optimal + counts.good) / decisions : 1,
  };
}

export function teamOfSeat(seat: Seat): 0 | 1 {
  return teamOf(seat);
}
