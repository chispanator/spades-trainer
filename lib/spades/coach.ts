import {
  Card,
  RANK_LABEL,
  SUIT_NAME,
  Seat,
  cardName,
  partnerOf,
  rankOf,
  suitOf,
  teamOf,
} from './cards';
import { TrickCard, beatsTrick, legalMoves, winningIndex } from './rules';
import { CandidateEval, EvalResult, TrickEstimate, BidBreakdown, pairedDifference } from './mc';

export type Grade = 'optimal' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/**
 * Thresholds in EV points, calibrated against scripts/selftest.ts: a decent
 * rollout policy gives up 0.00 points at the median, 0.68 at p90 and 1.71 at
 * p97, and Monte Carlo noise at the sample counts used here is about 0.07.
 */
const GRADE_CUTOFFS: { grade: Grade; maxLoss: number }[] = [
  { grade: 'optimal', maxLoss: 0.1 },
  { grade: 'good', maxLoss: 0.4 },
  { grade: 'inaccuracy', maxLoss: 1.0 },
  { grade: 'mistake', maxLoss: 2.5 },
  { grade: 'blunder', maxLoss: Infinity },
];

export const GRADE_LABEL: Record<Grade, string> = {
  optimal: 'Optimal',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

export interface PlaySituation {
  seat: Seat;
  hand: Card[];
  trick: TrickCard[];
  bids: number[];
  tricksWon: number[];
  spadesBroken: boolean;
  trickNumber: number; // 1-13
}

export interface PlayReview {
  trickNumber: number;
  played: Card;
  best: Card;
  grade: Grade;
  /** EV points given up versus the best card. Never negative. */
  loss: number;
  stdError: number;
  significant: boolean;
  /** The engine leans elsewhere, but the gap is inside its own margin of error. */
  withinNoise: boolean;
  playedEval: CandidateEval;
  bestEval: CandidateEval;
  ranked: CandidateEval[];
  headline: string;
  notes: string[];
  trickBefore: TrickCard[];
  hadChoice: boolean;
}

function contractOf(bids: number[], team: 0 | 1): number {
  const seats: Seat[] = team === 0 ? [0, 2] : [1, 3];
  return seats.reduce<number>((n, s) => n + (bids[s] === 0 ? 0 : bids[s]), 0);
}

function tricksOf(tricksWon: number[], team: 0 | 1): number {
  const seats: Seat[] = team === 0 ? [0, 2] : [1, 3];
  return seats.reduce<number>((n, s) => n + tricksWon[s], 0);
}

function seatLabel(seat: Seat, from: Seat): string {
  if (seat === from) return 'you';
  if (seat === partnerOf(from)) return 'your partner';
  return seat === 1 ? 'West' : 'East';
}

function gradeFor(loss: number, significant: boolean): Grade {
  if (!significant) return 'optimal';
  for (const c of GRADE_CUTOFFS) if (loss <= c.maxLoss) return c.grade;
  return 'blunder';
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Turns one decision into a grade plus an explanation. The grade comes from the
 * simulation; the words come from reading the position, so the advice says
 * *why* rather than only *how much*.
 */
export function reviewPlay(
  sit: PlaySituation,
  played: Card,
  res: EvalResult
): PlayReview {
  const ranked = res.candidates;
  const best = ranked[0];
  const playedEval = ranked.find((c) => c.card === played) ?? best;
  const diff = pairedDifference(res, best.card, played);
  const loss = Math.max(0, diff.mean);
  // Demand the gap clear the engine's own noise before calling it an error.
  const meaningful = loss > 0.1;
  const significant = meaningful && loss > 1.96 * diff.stdError;
  const withinNoise = meaningful && !significant;
  const grade = gradeFor(loss, significant);
  const hadChoice = ranked.length > 1;

  const notes = hadChoice ? buildNotes(sit, played, best.card, playedEval, best, grade) : [];
  const headline = buildHeadline(grade, played, best.card, loss, hadChoice, withinNoise);

  return {
    trickNumber: sit.trickNumber,
    played,
    best: best.card,
    grade,
    loss,
    stdError: diff.stdError,
    significant,
    withinNoise,
    playedEval,
    bestEval: best,
    ranked,
    headline,
    notes,
    trickBefore: sit.trick.slice(),
    hadChoice,
  };
}

function buildHeadline(
  grade: Grade,
  played: Card,
  best: Card,
  loss: number,
  hadChoice: boolean,
  withinNoise: boolean
): string {
  if (!hadChoice) return `Forced — ${cardName(played)} was your only legal card.`;
  if (played === best) return `Optimal — ${cardName(played)} is the top play.`;
  if (withinNoise) {
    return `Close call — the engine leans to ${cardName(best)}, but the gap is inside its margin of error.`;
  }
  switch (grade) {
    case 'optimal':
      return `Optimal — ${cardName(played)} is as good as ${cardName(best)} here.`;
    case 'good':
      return `Good — ${cardName(best)} is a shade better, but this costs almost nothing.`;
    case 'inaccuracy':
      return `Inaccuracy — ${cardName(best)} was better, worth about ${loss.toFixed(1)} points.`;
    case 'mistake':
      return `Mistake — ${cardName(best)} was clearly better, worth about ${loss.toFixed(1)} points.`;
    default:
      return `Blunder — ${cardName(best)} was far better, worth about ${loss.toFixed(1)} points.`;
  }
}

function buildNotes(
  sit: PlaySituation,
  played: Card,
  best: Card,
  playedEval: CandidateEval,
  bestEval: CandidateEval,
  grade: Grade
): string[] {
  const notes: string[] = [];
  const { seat, trick, bids, tricksWon, hand } = sit;
  const team = teamOf(seat);
  const contract = contractOf(bids, team);
  const teamTricks = tricksOf(tricksWon, team);
  const stillNeeded = contract - teamTricks;
  const tricksLeft = hand.length;
  const partner = partnerOf(seat);

  const leading = trick.length === 0;
  const isLast = trick.length === 3;
  const leadSuit = leading ? null : suitOf(trick[0].card);
  const voidInLead = !leading && !hand.some((c) => suitOf(c) === leadSuit);
  const currentWinner = leading ? null : trick[winningIndex(trick)];
  const partnerWinning = currentWinner?.seat === partner;

  const playedTakesLead = beatsTrick(played, trick);
  const bestTakesLead = beatsTrick(best, trick);
  const playedIsSpade = suitOf(played) === 3;
  const bestIsSpade = suitOf(best) === 3;

  const iAmNil = bids[seat] === 0;
  const partnerNil = bids[partner] === 0 && tricksWon[partner] === 0;
  const oppNil = [1, 3]
    .map((o) => ((seat + o) % 4) as Seat)
    .filter((o) => bids[o] === 0 && tricksWon[o] === 0);

  // ---- nil situations dominate everything else ----
  if (iAmNil) {
    if (playedTakesLead && !bestTakesLead) {
      notes.push(
        `You bid nil. ${cardName(played)} takes the lead here — one trick is all it takes to turn +100 into -100.`
      );
    } else if (playedTakesLead) {
      notes.push(`You bid nil and could not stay under. ${cardName(best)} was the least dangerous card.`);
    } else if (rankOf(played) < rankOf(best) && suitOf(played) === suitOf(best)) {
      notes.push(
        `On nil, shed the highest card that still loses. Keeping ${cardName(best)} back means you may be stuck winning with it later.`
      );
    }
  } else if (partnerNil) {
    if (bestTakesLead && !playedTakesLead) {
      notes.push(
        `Your partner is on nil. You have to take these tricks so they never get stuck with one — ${cardName(best)} covers, ${cardName(played)} leaves the trick alive.`
      );
    } else if (leading && !bestTakesLead) {
      notes.push(`With partner on nil, lead high so they can safely throw away their dangerous cards.`);
    }
  } else if (oppNil.length && bestTakesLead === false && leading) {
    notes.push(
      `${seatLabel(oppNil[0], seat)} is on nil. Leading low is how you force a trick onto them.`
    );
  }

  // ---- partner already owns the trick ----
  if (!leading && partnerWinning && !iAmNil) {
    const winCard = currentWinner!.card;
    if (playedIsSpade && suitOf(winCard) !== 3 && !bestIsSpade) {
      notes.push(
        `Your partner was already winning with ${cardName(winCard)}. Trumping with ${cardName(played)} takes the trick off your own side and burns a spade you will want later.`
      );
    } else if (rankOf(played) > rankOf(best) && suitOf(played) === suitOf(best)) {
      const safe = isLast ? 'nothing behind you can beat it' : 'their card is strong enough to hold up';
      notes.push(
        `Partner's ${cardName(winCard)} already had the trick and ${safe}. ${cardName(played)} is wasted under it — ${cardName(best)} keeps the big card for a trick you actually need.`
      );
    }
  }

  // ---- winning versus ducking ----
  if (!leading && !partnerWinning && !iAmNil) {
    if (bestTakesLead && !playedTakesLead && stillNeeded > 0) {
      const who = currentWinner ? seatLabel(currentWinner.seat, seat) : 'the opponents';
      notes.push(
        `Your side still needs ${stillNeeded} more trick${stillNeeded === 1 ? '' : 's'} from the ${tricksLeft} left. ${cardName(best)} wins this one; ${cardName(played)} hands it to ${who}.`
      );
    }
    if (!bestTakesLead && playedTakesLead && stillNeeded <= 0) {
      notes.push(
        `Your bid of ${contract} is already in the bag. Extra tricks are bags worth -1 each, and ten of them cost 100 — ducking with ${cardName(best)} is the disciplined play.`
      );
    }
    if (
      bestTakesLead &&
      playedTakesLead &&
      suitOf(played) === suitOf(best) &&
      rankOf(played) > rankOf(best)
    ) {
      notes.push(
        `${cardName(best)} wins this trick just as well. Spending ${cardName(played)} on it throws away a later winner.`
      );
    }
  }

  // ---- ruffing ----
  if (voidInLead && !iAmNil) {
    if (bestIsSpade && !playedIsSpade && stillNeeded > 0) {
      notes.push(
        `You are out of ${SUIT_NAME[leadSuit!].toLowerCase()}, so a spade takes the trick for free. Discarding instead gives away a trick you can simply have.`
      );
    } else if (!bestIsSpade && playedIsSpade && (partnerWinning || stillNeeded <= 0)) {
      notes.push(
        `No need to spend a trump here — ${cardName(best)} is a safe discard and keeps ${cardName(played)} for a trick that matters.`
      );
    }
  }

  // ---- leading ----
  if (leading) {
    if (suitOf(best) !== suitOf(played)) {
      const playedLen = hand.filter((c) => suitOf(c) === suitOf(played)).length;
      const bestLen = hand.filter((c) => suitOf(c) === suitOf(best)).length;
      notes.push(
        `Leading ${SUIT_NAME[suitOf(best)].toLowerCase()} works better than ${SUIT_NAME[suitOf(played)].toLowerCase()} from this hand.`
      );
      if (playedLen >= 6 && bestLen < playedLen) {
        notes.push(
          `You hold ${playedLen} ${SUIT_NAME[suitOf(played)].toLowerCase()}, which means the other three seats are short in the suit. After a round or two they run out and start trumping, so the length is worth far less than it looks.`
        );
      } else if (bestLen <= 2 && !bestIsSpade && hand.some((c) => suitOf(c) === 3)) {
        notes.push(
          `Leading your ${bestLen === 1 ? 'singleton' : 'doubleton'} ${SUIT_NAME[suitOf(best)].toLowerCase()} is how you make yourself void, so your spades can start taking tricks by ruffing.`
        );
      }
    }
    if (playedIsSpade && !bestIsSpade && !sit.spadesBroken) {
      notes.push(`Breaking spades yourself hands the opponents control of the trump suit early.`);
    }
    const topOfSuit = hand
      .filter((c) => suitOf(c) === suitOf(played))
      .reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a), played);
    if (rankOf(played) < rankOf(topOfSuit) && best === topOfSuit) {
      notes.push(
        `Leading small away from your own ${RANK_LABEL[rankOf(topOfSuit)]} lets an opponent's honour beat it. Cash ${cardName(topOfSuit)} while it is still good.`
      );
    }
  }

  // ---- the numbers, always worth showing when they moved ----
  const makeDelta = bestEval.makeProb - playedEval.makeProb;
  if (Math.abs(makeDelta) >= 0.03) {
    notes.push(
      `Chance of making your contract: ${pct(playedEval.makeProb)} after ${cardName(played)}, ${pct(bestEval.makeProb)} after ${cardName(best)}.`
    );
  }
  const trickDelta = bestEval.avgTeamTricks - playedEval.avgTeamTricks;
  if (Math.abs(trickDelta) >= 0.2) {
    notes.push(
      `Expected tricks for your side: ${playedEval.avgTeamTricks.toFixed(1)} versus ${bestEval.avgTeamTricks.toFixed(1)}.`
    );
  }
  const bagDelta = playedEval.avgBags - bestEval.avgBags;
  if (bagDelta >= 0.25) {
    notes.push(`It also picks up about ${bagDelta.toFixed(1)} extra bag${bagDelta >= 1.5 ? 's' : ''}.`);
  }

  if (!notes.length && grade !== 'optimal') {
    notes.push(
      `The simulation prefers ${cardName(best)} across the layouts the opponents could hold, though the reason is positional rather than a single obvious trick.`
    );
  }
  return notes;
}

// ------------------------------------------------------------ bid coaching --

export interface BidReview {
  bid: number;
  suggested: number;
  suggestNil: boolean;
  estimate: TrickEstimate;
  breakdown: BidBreakdown;
  grade: Grade;
  headline: string;
  notes: string[];
}

export function suggestBid(estimate: TrickEstimate): { bid: number; nil: boolean } {
  if (estimate.nilProb >= 0.55 && estimate.expected < 0.9) return { bid: 0, nil: true };
  const rounded = Math.round(estimate.expected);
  return { bid: Math.max(1, Math.min(13, rounded)), nil: false };
}

export function reviewBid(
  bid: number,
  hand: Card[],
  estimate: TrickEstimate,
  breakdown: BidBreakdown,
  partnerBid: number | null
): BidReview {
  const s = suggestBid(estimate);
  const suggested = s.bid;
  const notes: string[] = [];

  const atLeast = (n: number) =>
    estimate.distribution.slice(n).reduce<number>((a, b) => a + b, 0);

  if (bid === 0) {
    notes.push(
      `Across ${estimate.samples} simulated layouts this hand took zero tricks ${pct(estimate.nilProb)} of the time.`
    );
    if (estimate.nilProb < 0.4) {
      notes.push(
        `That is a thin nil. A busted nil costs 100 and drags your partner's bid down with it.`
      );
    }
  } else {
    notes.push(
      `Simulation says this hand averages ${estimate.expected.toFixed(1)} tricks; it takes ${bid} or more ${pct(atLeast(bid))} of the time.`
    );
    if (estimate.nilProb >= 0.45) {
      notes.push(`It also came up empty ${pct(estimate.nilProb)} of the time — worth a look at nil.`);
    }
  }

  if (breakdown.lines.length) {
    notes.push(
      `Counting by hand: ${breakdown.lines
        .map((l) => `${l.label} ${l.value.toFixed(1)}`)
        .join(', ')} — about ${breakdown.total.toFixed(1)}.`
    );
  } else {
    notes.push(`Counting by hand there is not a single sure trick in it.`);
  }

  if (partnerBid !== null && partnerBid > 0 && bid > 0 && partnerBid + bid >= 9) {
    notes.push(
      `Your side is now committed to ${partnerBid + bid}. Team bids that high are set far more often than they are made.`
    );
  }

  const off = Math.abs(bid - suggested);
  let grade: Grade;
  if (bid === 0 || suggested === 0) {
    grade = bid === suggested ? 'optimal' : estimate.nilProb >= 0.4 ? 'good' : 'mistake';
  } else if (off === 0) grade = 'optimal';
  else if (off === 1) grade = 'good';
  else if (off === 2) grade = 'inaccuracy';
  else grade = 'mistake';

  let headline: string;
  if (bid === suggested) {
    headline = bid === 0 ? 'Nil is the right call on this hand.' : `${bid} is the right bid.`;
  } else if (s.nil) {
    headline = `This hand is a nil candidate — it takes no tricks ${pct(estimate.nilProb)} of the time.`;
  } else if (bid > suggested) {
    headline = `${bid} is ${off} too many — the hand plays for about ${estimate.expected.toFixed(1)}.`;
  } else {
    headline = `${bid} leaves tricks on the table — the hand plays for about ${estimate.expected.toFixed(1)}.`;
  }

  return { bid, suggested: s.nil ? 0 : suggested, suggestNil: s.nil, estimate, breakdown, grade, headline, notes };
}

/** Cards the player could legally have chosen, for the review UI. */
export function choicesAt(sit: PlaySituation): Card[] {
  return legalMoves(sit.hand, sit.trick, sit.spadesBroken);
}
