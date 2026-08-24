import {
  Card,
  RANK_LABEL,
  RANK_WORD,
  SUIT_ADJECTIVE,
  SUIT_NAME,
  Seat,
  cardName,
  partnerOf,
  rankOf,
  suitOf,
  teamOf,
} from './cards';
import { TrickCard, beatsTrick, legalMoves, winningIndex } from './rules';
import {
  CandidateEval,
  EvalResult,
  TrickEstimate,
  BidBreakdown,
  CONFIDENCE_Z,
  NOISE_FLOOR,
  confirmationHalf,
  pairedDifference,
  selectionHalf,
} from './mc';
import { TiebreakContext, isSureWinner, preferAmongEquals } from './judgment';

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
  /** Cards neither played nor in hand. Needed to tell a winner from a spot card. */
  unseen: Card[];
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
  /**
   * The simulation's top row is a different card, but it cannot show that card
   * is better - so nothing is recommended and this is said instead of advice.
   */
  withinNoise: boolean;
  /** Cards the simulation could not tell apart, best row first. */
  tied: Card[];
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

/** Is A better than B by more than the simulation's own margin of error? */
function provablyBetter(
  res: EvalResult,
  a: Card,
  b: Card,
  window?: { from: number; to: number }
): boolean {
  const d = pairedDifference(res, a, b, window);
  return d.mean > NOISE_FLOOR && d.mean > CONFIDENCE_Z * d.stdError;
}

function tiebreakContext(sit: PlaySituation): TiebreakContext {
  return { seat: sit.seat, hand: sit.hand, bids: sit.bids, unseen: sit.unseen };
}

/**
 * Turns one decision into a grade plus an explanation. The grade comes from the
 * simulation; the words come from reading the position, so the advice says
 * *why* rather than only *how much*.
 *
 * The card it recommends is chosen under one rule: never name a card unless the
 * simulation can prove it beats the one that was played. Sorting by expected
 * value and reading off the top row does not clear that bar - the top row of a
 * dozen noisy estimates is partly just the luckiest sample - and it is how a
 * trainer ends up telling a player to throw an ace away over a gap it admits in
 * the same breath is inside its own margin of error. Where several plays are
 * genuinely level, the tie goes to spades judgement instead, in judgment.ts.
 */
export function reviewPlay(
  sit: PlaySituation,
  played: Card,
  res: EvalResult
): PlayReview {
  const ranked = res.candidates;
  const leader = ranked[0];
  const hadChoice = ranked.length > 1;

  // Everything the simulation cannot separate from its own top row. These are
  // the plays that are still in contention; the ordering within them is not.
  // Only cards carried through to the final round are eligible: a card dropped
  // earlier was dropped for being measurably worse, and it has no paired
  // samples left to argue with.
  const select = selectionHalf(res);
  const confirm = confirmationHalf(res);
  const tied = ranked
    .filter((c) => res.rowOf.has(c.card))
    .filter((c) => c.card === leader.card || !provablyBetter(res, leader.card, c.card, select))
    .map((c) => c.card);

  // Of those, the ones that look better than what was played - on the half of
  // the deals set aside for looking.
  const better = tied.filter((c) => c !== played && provablyBetter(res, c, played, select));
  const proposed = better.length ? preferAmongEquals(better, tiebreakContext(sit)) : played;
  // ...and then the claim has to survive the half it was not chosen on. This is
  // what stops a card that merely drew a flattering set of deals from being
  // handed to the player as advice.
  const confirmed = proposed !== played && provablyBetter(res, proposed, played, confirm);

  // A played card with no paired samples was knocked out in the first round,
  // which is a verdict of its own. Callers hand it to `include` so this does not
  // normally happen; falling through to "optimal" if it ever did would be the
  // one wrong way to be careful.
  const eliminated = !res.rowOf.has(played);
  const best = confirmed || eliminated ? (proposed === played ? leader.card : proposed) : played;

  const playedEval = ranked.find((c) => c.card === played) ?? leader;
  const bestEval = ranked.find((c) => c.card === best) ?? playedEval;
  const diff =
    best === played
      ? { mean: 0, stdError: 0 }
      : eliminated
        ? { mean: bestEval.ev - playedEval.ev, stdError: 0 }
        : pairedDifference(res, best, played);
  const loss = Math.max(0, diff.mean);
  const significant = best !== played;
  // The engine has a preference it cannot back up. Worth saying out loud rather
  // than dressing up as advice.
  const withinNoise = best === played && hadChoice && leader.card !== played;
  const grade = gradeFor(loss, significant);

  // Ordered most specific first, then capped: a wall of bullets reads as noise.
  const notes = hadChoice
    ? buildNotes(sit, played, best, playedEval, bestEval, grade, ranked, tied).slice(0, 5)
    : [];
  const headline = buildHeadline(grade, played, best, loss, hadChoice, withinNoise, tied.length);

  return {
    trickNumber: sit.trickNumber,
    played,
    best,
    grade,
    loss,
    stdError: diff.stdError,
    significant,
    withinNoise,
    tied,
    playedEval,
    bestEval,
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
  withinNoise: boolean,
  tiedCount: number
): string {
  if (!hadChoice) return `Forced — ${cardName(played)} was your only legal card.`;
  if (played === best) {
    if (withinNoise && tiedCount > 1) {
      return `Optimal — nothing here beats ${cardName(played)} by more than the engine can measure.`;
    }
    return `Optimal — ${cardName(played)} is the top play.`;
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
  grade: Grade,
  ranked: CandidateEval[],
  tied: Card[]
): string[] {
  const notes: string[] = [];
  const { seat, trick, bids, tricksWon, hand } = sit;
  const team = teamOf(seat);
  const contract = contractOf(bids, team);
  const teamTricks = tricksOf(tricksWon, team);
  const stillNeeded = contract - teamTricks;
  const tricksLeft = hand.length;
  const partner = partnerOf(seat);
  const oppTeam = (team === 0 ? 1 : 0) as 0 | 1;
  const oppStillShort = contractOf(bids, oppTeam) - tricksOf(tricksWon, oppTeam);

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

  // ---- the engine has a preference it cannot back up ----
  // First, because a top row that disagrees with you is the thing you notice,
  // and the honest answer is that the disagreement is smaller than the noise.
  if (best === played && tied.length > 1 && ranked[0].card !== played) {
    const leader = ranked[0].card;
    const gap = (ranked[0].ev - playedEval.ev).toFixed(2);
    const wouldThrowAWinner =
      !iAmNil && !beatsTrick(leader, trick) && isSureWinner(leader, sit.unseen);
    if (wouldThrowAWinner) {
      notes.push(
        `The engine's top row is ${cardName(leader)}, ahead by ${gap} points — inside its own margin of error over ${playedEval.samples} deals, so that ordering is sampling noise and not a finding. ${cardName(leader)} is the highest ${SUIT_NAME[suitOf(leader)].toLowerCase()} nobody has played: a trick in your hand for as long as you hold it, and nothing at all once you throw it under a trick you were never going to win. Where the numbers come out level, keep the card that wins something.`
      );
    } else {
      notes.push(
        `${tied.length} cards come out level here. The engine puts ${cardName(leader)} ${gap} points ahead of ${cardName(played)}, which is inside its margin of error over ${playedEval.samples} deals — there is nothing to fix.`
      );
    }
  }

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

  // ---- threw a winner away ----
  if (!leading && !iAmNil && !playedTakesLead && best !== played && isSureWinner(played, sit.unseen)) {
    notes.push(
      `${cardName(played)} is the highest ${SUIT_NAME[suitOf(played)].toLowerCase()} still out. Held, it wins a trick whenever the suit comes round; spent here it won nothing, and ${cardName(best)} would have cost you nothing to throw.`
    );
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
        oppStillShort > 0
          ? `Your side already has its ${contract}, and the opponents are not close enough to be caught — with ${tricksLeft} left they only need ${oppStillShort} more. So this trick buys a bag and nothing else, and ducking with ${cardName(best)} is the disciplined play.`
          : `Your side already has its ${contract} and the opponents have theirs. An overtrick scores +1 tonight but every tenth bag costs 100, so a trick you did not bid for is worth about -9. ${cardName(best)} lets it go.`
      );
    }
    if (bestTakesLead && stillNeeded <= 0 && oppStillShort > 0 && !playedTakesLead) {
      notes.push(
        `You have your bid, but the opponents are still ${oppStillShort} short with ${tricksLeft} to play. A trick you take now is one they cannot get back — setting them is worth far more than the bag costs you.`
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
    const playedSuit = suitOf(played);
    const playedSuitName = SUIT_NAME[playedSuit].toLowerCase();
    const held = hand.filter((c) => suitOf(c) === playedSuit);
    const heldRanks = held.map(rankOf);
    const topHeld = Math.max(...heldRanks);
    const holdsAce = heldRanks.includes(12);

    /*
      "Always cash your aces" is the most common rule players bring to spades,
      and the guarantee behind it is real. What it misses is the price of the
      lead itself, so the answer has to concede the first point before making
      the second - and with this position's own numbers, not a slogan.
    */
    if (rankOf(played) === 12 && playedSuit !== 3 && suitOf(best) !== playedSuit) {
      const holdsKing = heldRanks.includes(11);
      const mineTotal = playedEval.avgTeamTricks;
      const theirsTotal = bestEval.avgTeamTricks;
      if (theirsTotal > mineTotal + 0.03) {
        notes.push(
          `Cashing the ace does bank the trick — that part of the plan works, and it is the one card nobody can beat. The price is the lead: winning it puts you back on play, and whoever opens a suit tends to give a trick away in it. Your side finishes with ${mineTotal.toFixed(1)} tricks after ${cardName(played)} against ${theirsTotal.toFixed(1)} after ${cardName(best)} — the ace is safe either way, the rest of the hand is not.${
            holdsKing
              ? ''
              : ` With no king behind it, the ace wins one trick whenever you spend it, so there is rarely a hurry.`
          }`
        );
      }
    }

    /*
      Leading an honour while holding a higher one and no ace is a deliberate
      plan - spend this card to draw the ace and promote the one above it. It
      deserves an answer in its own terms, so compare the tricks the side ends
      up taking *in that suit* rather than only the overall value.
    */
    const promoting =
      !holdsAce && rankOf(played) >= 8 && rankOf(played) < topHeld && topHeld >= 10;
    if (promoting && suitOf(best) !== playedSuit) {
      const mine = playedEval.suitTricks[playedSuit];
      const theirs = bestEval.suitTricks[playedSuit];
      const promoted = RANK_WORD[topHeld];
      const spent = RANK_WORD[rankOf(played)];
      const suitAdj = SUIT_ADJECTIVE[playedSuit];
      if (mine <= theirs + 0.03) {
        notes.push(
          `Leading ${cardName(played)} to draw the ace and promote your ${promoted} is the right idea in principle, but it does not pay for itself here. Your side ends up with ${mine.toFixed(1)} ${suitAdj} tricks after ${cardName(played)}, against ${theirs.toFixed(1)} after ${cardName(best)} — opening the suit yourself gets you fewer of them, not more. You spend the ${spent} now and the ${promoted} still has to get past the ace; leave the suit for somebody else to broach and the ${promoted} comes home more often.`
        );
      } else {
        notes.push(
          `The promotion plan works — ${mine.toFixed(1)} ${suitAdj} tricks after ${cardName(played)} against ${theirs.toFixed(1)} after ${cardName(best)}. The cost is elsewhere in the hand, not in the idea.`
        );
      }
    }

    if (suitOf(best) !== playedSuit) {
      const playedLen = held.length;
      const bestLen = hand.filter((c) => suitOf(c) === suitOf(best)).length;

      // Separate "wrong suit" from "wrong card in the right suit" - they are
      // different mistakes and a player usually only made one of them.
      const inSuit = ranked.filter((c) => suitOf(c.card) === playedSuit);
      if (inSuit.length) {
        const bestInSuit = inSuit[0];
        const cardCost = bestInSuit.ev - playedEval.ev;
        const suitCost = bestEval.ev - bestInSuit.ev;
        if (cardCost <= 0.08) {
          notes.push(
            `Within ${playedSuitName}, ${cardName(played)} was the right card — the whole cost is in choosing the suit, not in which card you led.`
          );
        } else {
          notes.push(
            `Two separate decisions: choosing ${playedSuitName} costs ${suitCost.toFixed(2)}, and leading ${cardName(played)} rather than ${cardName(bestInSuit.card)} within it costs a further ${cardCost.toFixed(2)}.`
          );
        }
      }

      notes.push(
        `Leading ${SUIT_NAME[suitOf(best)].toLowerCase()} works better than ${playedSuitName} from this hand.`
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
  const setDelta = bestEval.setProb - playedEval.setProb;
  if (Math.abs(setDelta) >= 0.04) {
    notes.push(
      `Chance of setting the opponents: ${pct(playedEval.setProb)} after ${cardName(played)}, ${pct(bestEval.setProb)} after ${cardName(best)}.`
    );
  }
  const bagDelta = playedEval.avgBags - bestEval.avgBags;
  if (bagDelta >= 0.25) {
    notes.push(
      `It also picks up about ${bagDelta.toFixed(1)} extra bag${bagDelta >= 1.5 ? 's' : ''}, and a bag is worth roughly -9 once the ten-bag penalty is counted in.`
    );
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

// -------------------------------------------------------- hand counting --

export interface HandCountReview {
  yours: number[];
  engine: number[];
  totalYours: number;
  totalEngine: number;
  /** Your count minus the simulation's. Positive means you were optimistic. */
  delta: number;
  grade: Grade;
  headline: string;
  notes: string[];
}

/**
 * Compares the player's own suit-by-suit count against what the simulation
 * actually gets. The point is not the total - it is finding *which* suit the
 * player is misreading, since length and shortness are the two things people
 * most reliably get wrong.
 */
export function reviewHandCount(counts: number[], est: TrickEstimate): HandCountReview {
  const yours = counts.slice();
  const engine = est.bySuit.slice();
  const totalYours = yours.reduce((a, b) => a + b, 0);
  const totalEngine = est.expected;
  const delta = totalYours - totalEngine;
  const notes: string[] = [];

  for (let s = 3; s >= 0; s--) {
    const len = est.lengths[s];
    if (!len) continue;
    const gap = yours[s] - engine[s];
    const suit = SUIT_NAME[s].toLowerCase();

    if (gap >= 0.8) {
      if (s !== 3 && len >= 5) {
        notes.push(
          `You counted ${yours[s]} in ${suit} but the simulation gets ${engine[s].toFixed(1)}. Holding ${len} of them means the other three seats are short: after two rounds somebody is void and starts trumping, so the length past the winners is worth almost nothing.`
        );
      } else if (s !== 3) {
        notes.push(
          `${suit.charAt(0).toUpperCase() + suit.slice(1)} came to ${engine[s].toFixed(1)}, not ${yours[s]}. Honours below the ace only cash when the cards above them are placed kindly.`
        );
      } else {
        notes.push(
          `You counted ${yours[s]} spade tricks; the simulation gets ${engine[s].toFixed(1)}. Middling trumps get drawn out by the higher ones before they can do any work.`
        );
      }
    } else if (gap <= -0.8) {
      if (s === 3 && est.ruffs >= 0.5) {
        notes.push(
          `Spades were worth more than you gave them — ${engine[s].toFixed(1)}, and ${est.ruffs.toFixed(1)} of those come from ruffing rather than from the trumps themselves.`
        );
      } else {
        notes.push(
          `You undersold ${suit}: ${engine[s].toFixed(1)} tricks against the ${yours[s]} you counted.`
        );
      }
    }
  }

  const shortSuits = [0, 1, 2].filter((s) => est.lengths[s] <= 1);
  if (shortSuits.length && est.ruffs >= 0.5 && yours[3] <= engine[3]) {
    const names = shortSuits.map((s) => SUIT_NAME[s].toLowerCase()).join(' and ');
    notes.push(
      `Being short in ${names} is worth about ${est.ruffs.toFixed(1)} tricks, but they show up in the spade column — shortness pays in trumps, never in the suit you are short of.`
    );
  }

  const size = Math.abs(delta);
  let grade: Grade;
  if (size <= 0.5) grade = 'optimal';
  else if (size <= 1.0) grade = 'good';
  else if (size <= 2.0) grade = 'inaccuracy';
  else if (size <= 3.0) grade = 'mistake';
  else grade = 'blunder';

  let headline: string;
  if (size <= 0.5) {
    headline = `Spot on — you counted ${totalYours}, the simulation gets ${totalEngine.toFixed(1)}.`;
  } else if (delta > 0) {
    headline = `You are ${delta.toFixed(1)} tricks optimistic — you counted ${totalYours}, it plays for ${totalEngine.toFixed(1)}.`;
  } else {
    headline = `You are ${size.toFixed(1)} tricks light — you counted ${totalYours}, it plays for ${totalEngine.toFixed(1)}.`;
  }
  if (!notes.length) {
    notes.push(
      `No single suit is far out; the difference is spread thinly across the hand rather than sitting in one misread holding.`
    );
  }

  return { yours, engine, totalYours, totalEngine, delta, grade, headline, notes };
}

/** Cards the player could legally have chosen, for the review UI. */
export function choicesAt(sit: PlaySituation): Card[] {
  return legalMoves(sit.hand, sit.trick, sit.spadesBroken);
}
