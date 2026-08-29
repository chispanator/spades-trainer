import { Card, Seat, partnerOf, rankOf, suitOf } from './cards';
import { TrickCard, beatsTrick, winningIndex } from './rules';

/**
 * Spades knowledge, used *only* where the simulation runs out of resolution.
 *
 * A Monte Carlo estimate has a margin of error, and inside that margin the
 * ranking it produces is noise. Picking the top row anyway is how an engine
 * ends up advising you to throw an ace away: two plays it genuinely cannot
 * separate get ordered by the third decimal place of a random number.
 *
 * So when the simulation reports a tie, the tie is broken by what a player
 * knows rather than by sampling error. The rule is a single one: among plays
 * the engine values equally, part with the card you would least miss.
 */

export interface TiebreakContext {
  seat: Seat;
  hand: Card[];
  /** The trick as it stands, which decides whether this rule has anything to say. */
  trick: TrickCard[];
  /** Needed only to tell a nil apart from a contract; the tie itself is material. */
  bids: number[];
  /** Cards neither played nor in `hand` - what the other three seats still hold. */
  unseen: Card[];
}

/** Cards of the same suit, still out, that rank above this one. */
export function higherOutstanding(card: Card, unseen: Card[]): number {
  const s = suitOf(card);
  const r = rankOf(card);
  let n = 0;
  for (const c of unseen) if (suitOf(c) === s && rankOf(c) > r) n++;
  return n;
}

/**
 * A card nothing outstanding can beat in its own suit. Barring a ruff it is a
 * trick in hand, which makes throwing it away the most expensive thing a
 * discard can do.
 */
export function isSureWinner(card: Card, unseen: Card[]): boolean {
  return higherOutstanding(card, unseen) === 0;
}

const SURE_WINNER = 100;
const TRUMP = 40;
const GUARD = 6;

/**
 * A small card is worth more than its rank when it is the last thing standing
 * between an honour and being played bare. Throwing the 3 from K-3 leaves the
 * king alone to fall under the ace; with two spare cards you can afford one.
 */
function guardBonus(card: Card, hand: Card[]): number {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const inSuit = hand.filter((c) => suitOf(c) === suit);
  let lowestHonour = Infinity;
  for (const c of inSuit) {
    const r = rankOf(c);
    if (r >= 10 && r > rank && r < lowestHonour) lowestHonour = r;
  }
  if (lowestHonour === Infinity) return 0;
  const spares = inSuit.filter((c) => rankOf(c) < lowestHonour).length;
  return spares <= 1 ? GUARD : 0;
}

/**
 * What it costs to part with this card, on an arbitrary scale where only the
 * ordering matters. Higher means "keep it".
 */
export function keepValue(card: Card, ctx: TiebreakContext): number {
  const suit = suitOf(card);
  const rank = rankOf(card);

  // On nil the ranking is upside down. A high card is not an asset, it is the
  // thing most likely to win a trick you cannot afford, so the card you least
  // want to keep is the biggest one you hold.
  if (ctx.bids[ctx.seat] === 0) return -(rank + (suit === 3 ? 13 : 0));

  let v = rank;
  if (isSureWinner(card, ctx.unseen)) v += SURE_WINNER;
  if (suit === 3) v += TRUMP + rank; // trumps take tricks no side suit can
  v += guardBonus(card, ctx.hand);
  return v;
}

/**
 * Is this card being spent for nothing - thrown under a trick it cannot take?
 *
 * Leading is never that: any card can win a trick you are starting. Nor is a
 * card that would take the lead of the trick as it stands, unless your partner
 * already holds it, in which case anything you add is spent whatever its rank.
 */
function spentForNothing(card: Card, ctx: TiebreakContext): boolean {
  if (!ctx.trick.length) return false;
  const winner = ctx.trick[winningIndex(ctx.trick)];
  if (winner.seat === partnerOf(ctx.seat)) return true;
  return !beatsTrick(card, ctx.trick);
}

/**
 * Of several plays the simulation rates equally, the one to make - or null
 * where this rule has no business having an opinion.
 *
 * What it knows is one thing: do not throw material away for nothing. That is a
 * statement about discards, and it holds only while every play on the table is
 * one. The moment a candidate could take the trick, the card is not being lost,
 * it is being spent, and what it buys is the trick - which this rule cannot
 * price and the simulation can. Applying it anyway is how a hoarding bias gets
 * in: "cannot prove it is worse" is not "worth the same", and at the deal
 * counts the opponents run on, most plays cannot be told apart at all. Answer
 * every one of those by keeping the big cards back and you have an engine that
 * dribbles out spot cards for twelve tricks and cashes its aces at the end.
 */
export function preferAmongEquals(cards: Card[], ctx: TiebreakContext): Card | null {
  if (!cards.length) return null;
  if (!cards.every((c) => spentForNothing(c, ctx))) return null;
  return cards.reduce((best, c) => {
    const dk = keepValue(c, ctx) - keepValue(best, ctx);
    if (dk !== 0) return dk < 0 ? c : best;
    const dr = rankOf(c) - rankOf(best);
    if (dr !== 0) return dr < 0 ? c : best;
    return c < best ? c : best; // stable, so the same position always answers the same way
  });
}
