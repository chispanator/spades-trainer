import { Card, Seat, SuitIdx, rankOf, suitOf, partnerOf } from './cards';

export interface TrickCard {
  seat: Seat;
  card: Card;
}

/**
 * Legal plays. Standard rules: follow suit if able; spades may not be *led*
 * until they have been broken (played on an earlier trick), unless the hand
 * holds nothing else.
 */
export function legalMoves(hand: Card[], trick: TrickCard[], spadesBroken: boolean): Card[] {
  if (trick.length === 0) {
    if (spadesBroken) return hand.slice();
    const nonSpades = hand.filter((c) => suitOf(c) !== 3);
    return nonSpades.length ? nonSpades : hand.slice();
  }
  const lead = suitOf(trick[0].card);
  const follow = hand.filter((c) => suitOf(c) === lead);
  return follow.length ? follow : hand.slice();
}

/** Index into `trick` of the card currently winning (works on partial tricks). */
export function winningIndex(trick: TrickCard[]): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const bs = suitOf(trick[best].card);
    const ts = suitOf(trick[i].card);
    if (ts === bs) {
      if (rankOf(trick[i].card) > rankOf(trick[best].card)) best = i;
    } else if (ts === 3) {
      best = i; // a spade trumps any non-spade
    }
    // otherwise: off-suit discard, cannot win
  }
  return best;
}

export function trickWinner(trick: TrickCard[]): Seat {
  return trick[winningIndex(trick)].seat;
}

/** Would `card` take the lead of this (possibly partial) trick right now? */
export function beatsTrick(card: Card, trick: TrickCard[]): boolean {
  if (trick.length === 0) return true;
  const best = trick[winningIndex(trick)].card;
  const bs = suitOf(best);
  const cs = suitOf(card);
  if (cs === bs) return rankOf(card) > rankOf(best);
  return cs === 3;
}

export function leadSuitOf(trick: TrickCard[]): SuitIdx | null {
  return trick.length ? suitOf(trick[0].card) : null;
}

// ---------------------------------------------------------------- scoring --

export interface TeamHandScore {
  score: number;
  bagsEarned: number;
  bagsAfter: number;
  contract: number;
  tricks: number;
  madeContract: boolean;
  nilResults: { seat: Seat; made: boolean }[];
  /** How many times the ten-bag penalty fired this hand. */
  bagPenalties: number;
}

/**
 * Scores one team for one hand.
 *   made bid  -> 10 x bid, +1 per overtrick ("bag")
 *   set       -> -10 x bid
 *   nil made  -> +100 ; nil failed -> -100 (and that player's tricks count as bags)
 *   10 bags   -> -100 and 10 bags are cleared
 * `bid === 0` means nil.
 */
export function scoreTeamHand(
  seats: [Seat, Seat],
  bids: number[],
  tricksWon: number[],
  bagsBefore: number
): TeamHandScore {
  let score = 0;
  let contract = 0;
  let tricks = 0;
  const nilResults: { seat: Seat; made: boolean }[] = [];

  for (const seat of seats) {
    const bid = bids[seat];
    const tr = tricksWon[seat];
    if (bid === 0) {
      const made = tr === 0;
      nilResults.push({ seat, made });
      score += made ? 100 : -100;
      if (!made) tricks += tr; // a busted nil's tricks count toward the contract
    } else {
      contract += bid;
      tricks += tr;
    }
  }

  let bagsEarned = 0;
  let madeContract = true;
  if (contract > 0) {
    if (tricks >= contract) {
      score += 10 * contract;
      bagsEarned = tricks - contract;
      score += bagsEarned;
    } else {
      score -= 10 * contract;
      madeContract = false;
    }
  } else {
    bagsEarned = tricks;
    score += bagsEarned;
  }

  let bagsAfter = bagsBefore + bagsEarned;
  let bagPenalties = 0;
  while (bagsAfter >= 10) {
    score -= 100;
    bagsAfter -= 10;
    bagPenalties++;
  }

  return { score, bagsEarned, bagsAfter, contract, tricks, madeContract, nilResults, bagPenalties };
}

export const TEAM_SEATS: [[Seat, Seat], [Seat, Seat]] = [
  [0, 2],
  [1, 3],
];

/** True when `seat`'s partner bid nil and has not taken a trick yet. */
export function partnerNilAlive(bids: number[], tricksWon: number[], seat: Seat): boolean {
  const p = partnerOf(seat);
  return bids[p] === 0 && tricksWon[p] === 0;
}
