import { Card, RNG, Seat, shuffle, suitOf } from './cards';
import { TrickCard } from './rules';

export type VoidTable = boolean[][]; // [seat][suit]

export function emptyVoids(): VoidTable {
  return [
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ];
}

/**
 * Everything an observer can legitimately deduce about who cannot hold what:
 * a player who did not follow suit is void in that suit for the rest of the hand.
 */
export function deriveVoids(tricks: TrickCard[][]): VoidTable {
  const voids = emptyVoids();
  for (const trick of tricks) {
    if (!trick.length) continue;
    const lead = suitOf(trick[0].card);
    for (const tc of trick) {
      if (suitOf(tc.card) !== lead) voids[tc.seat][lead] = true;
    }
  }
  return voids;
}

export interface InfoSet {
  observer: Seat;
  /** The observer's own remaining cards. */
  hand: Card[];
  /** Cards remaining per seat (observer's entry equals hand.length). */
  handSizes: number[];
  voids: VoidTable;
  /** Cards not yet played and not in the observer's hand. */
  unseen: Card[];
}

/**
 * Randomly assigns the unseen cards to the other three seats, respecting hand
 * sizes and known voids. Cards with the fewest eligible homes are placed first;
 * within that, seats are picked in proportion to how many cards they still need.
 */
export function dealUnseen(info: InfoSet, rng: RNG): Card[][] {
  const seats: Seat[] = [0, 1, 2, 3];
  const targets = seats.filter((s) => s !== info.observer);

  for (let attempt = 0; attempt < 24; attempt++) {
    const result = tryDeal(info, targets, rng, false);
    if (result) return result;
  }
  // The void constraints could not be satisfied - rare, and only from unusual
  // hand shapes. Relax them rather than failing, then fall back to a plain
  // chunked deal, so a simulation can never crash on an awkward layout.
  return tryDeal(info, targets, rng, true) ?? naiveDeal(info, targets, rng);
}

function naiveDeal(info: InfoSet, targets: Seat[], rng: RNG): Card[][] {
  const cards = shuffle(info.unseen, rng);
  const out: Card[][] = [[], [], [], []];
  let i = 0;
  for (const s of targets) {
    out[s] = cards.slice(i, i + info.handSizes[s]);
    i += info.handSizes[s];
  }
  out[info.observer] = info.hand.slice();
  return out;
}

function tryDeal(info: InfoSet, targets: Seat[], rng: RNG, ignoreVoids: boolean): Card[][] | null {
  const need = [0, 0, 0, 0];
  for (const s of targets) need[s] = info.handSizes[s];

  const eligibleCount = (c: Card) => {
    if (ignoreVoids) return targets.length;
    let n = 0;
    for (const s of targets) if (!info.voids[s][suitOf(c)]) n++;
    return n;
  };

  const cards = shuffle(info.unseen, rng);
  cards.sort((a, b) => eligibleCount(a) - eligibleCount(b));

  let outstanding = targets.reduce<number>((n, s) => n + need[s], 0);
  const out: Card[][] = [[], [], [], []];
  for (const c of cards) {
    if (outstanding === 0) break; // more unseen cards than seats to fill
    let total = 0;
    const opts: Seat[] = [];
    for (const s of targets) {
      if (need[s] <= 0) continue;
      if (!ignoreVoids && info.voids[s][suitOf(c)]) continue;
      opts.push(s);
      total += need[s];
    }
    if (!opts.length) return null;
    let r = rng() * total;
    let chosen = opts[opts.length - 1];
    for (const s of opts) {
      r -= need[s];
      if (r <= 0) {
        chosen = s;
        break;
      }
    }
    out[chosen].push(c);
    need[chosen]--;
    outstanding--;
  }
  if (outstanding > 0) return null;
  out[info.observer] = info.hand.slice();
  return out;
}
