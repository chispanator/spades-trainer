import { Card, Seat, partnerOf, rankOf, suitOf } from './cards';
import { beatsTrick, legalMoves, winningIndex } from './rules';
import { PlayState } from './playstate';

const lowest = (cards: Card[]): Card =>
  cards.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a));
const highest = (cards: Card[]): Card =>
  cards.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));

/** Lowest card, preferring a non-spade so trumps are kept back. */
function lowestKeepSpades(cards: Card[]): Card {
  const off = cards.filter((c) => suitOf(c) !== 3);
  return lowest(off.length ? off : cards);
}

/** Highest throw-away, preferring a non-spade. */
function highestKeepSpades(cards: Card[]): Card {
  const off = cards.filter((c) => suitOf(c) !== 3);
  return highest(off.length ? off : cards);
}

function tricksRemaining(st: PlayState): number {
  return st.hands[st.turn].length;
}

/** Does this seat's side still want to win tricks? */
export function wantsTrick(st: PlayState, seat: Seat): boolean {
  if (st.bids[seat] === 0) return false; // I am nil
  const p = partnerOf(seat);
  if (st.bids[p] === 0) {
    if (st.tricksWon[p] === 0) return true; // cover a live nil
  }
  const contract = (st.bids[seat] || 0) + (st.bids[p] === 0 ? 0 : st.bids[p]);
  const won = st.tricksWon[seat] + (st.bids[p] === 0 ? 0 : st.tricksWon[p]);
  if (won < contract) return true;

  // Contract is in hand. Only keep fighting when it can still set the opponents.
  const o1 = ((seat + 1) % 4) as Seat;
  const o2 = ((seat + 3) % 4) as Seat;
  const oppContract = (st.bids[o1] === 0 ? 0 : st.bids[o1]) + (st.bids[o2] === 0 ? 0 : st.bids[o2]);
  const oppWon = st.tricksWon[o1] + st.tricksWon[o2];
  const oppShort = oppContract - oppWon;
  return oppShort > 0 && tricksRemaining(st) <= oppShort + 1;
}

/** Is an opponent of `seat` running a nil that is still alive? */
function oppNilAlive(st: PlayState, seat: Seat): boolean {
  const o1 = ((seat + 1) % 4) as Seat;
  const o2 = ((seat + 3) % 4) as Seat;
  return (
    (st.bids[o1] === 0 && st.tricksWon[o1] === 0) || (st.bids[o2] === 0 && st.tricksWon[o2] === 0)
  );
}

function shortestSuitLow(cards: Card[]): Card {
  const bySuit = new Map<number, Card[]>();
  for (const c of cards) {
    const s = suitOf(c);
    if (!bySuit.has(s)) bySuit.set(s, []);
    bySuit.get(s)!.push(c);
  }
  let best: Card[] | null = null;
  for (const [s, group] of bySuit) {
    if (s === 3 && bySuit.size > 1) continue; // don't lead trumps by accident
    if (!best || group.length < best.length) best = group;
  }
  return lowest(best ?? cards);
}

/**
 * Fast, sane rollout policy. Used for every seat inside a simulated hand.
 * Not a strong player, but consistent and cheap - which is what a Monte Carlo
 * playout needs.
 */
export function heuristicChoice(st: PlayState): Card {
  const seat = st.turn;
  const legal = legalMoves(st.hands[seat], st.trick, st.spadesBroken);
  if (legal.length === 1) return legal[0];

  const iAmNil = st.bids[seat] === 0;
  const want = wantsTrick(st, seat);

  // ---- leading ----
  if (st.trick.length === 0) {
    if (iAmNil) return lowestKeepSpades(legal);
    if (!want || oppNilAlive(st, seat)) return lowestKeepSpades(legal);

    const sideAces = legal.filter((c) => rankOf(c) === 12 && suitOf(c) !== 3);
    if (sideAces.length) return sideAces[0];

    const spades = legal.filter((c) => suitOf(c) === 3);
    if (spades.length) {
      const top = highest(spades);
      if (rankOf(top) >= 10) return top; // Q, K or A of spades: pull trumps
    }

    const sideKings = legal.filter(
      (c) => rankOf(c) === 11 && suitOf(c) !== 3 && st.hands[seat].filter((x) => suitOf(x) === suitOf(c)).length >= 2
    );
    if (sideKings.length) return sideKings[0];

    return shortestSuitLow(legal);
  }

  // ---- following ----
  const winIdx = winningIndex(st.trick);
  const partnerWinning = st.trick[winIdx].seat === partnerOf(seat);
  const isLast = st.trick.length === 3;
  const winners = legal.filter((c) => beatsTrick(c, st.trick));
  const losers = legal.filter((c) => !beatsTrick(c, st.trick));

  if (iAmNil) {
    if (losers.length) return highest(losers); // shed the most dangerous safe card
    return highest(legal); // forced to win anyway - dump the biggest problem
  }

  if (partnerWinning) {
    // Partner has it. Duck cheaply unless we are chasing bags we do not want.
    if (isLast) return lowestKeepSpades(legal);
    // Not last: a strong partner card is usually safe to trust.
    const partnerCard = st.trick[winIdx].card;
    const partnerStrong = rankOf(partnerCard) >= 11 || suitOf(partnerCard) === 3;
    if (partnerStrong || !want) return lowestKeepSpades(legal);
    if (winners.length) return lowest(winners);
    return lowestKeepSpades(legal);
  }

  if (want) {
    if (winners.length) return lowest(winners);
    return lowestKeepSpades(legal);
  }

  if (losers.length) return highestKeepSpades(losers);
  return lowest(winners);
}
