// Card encoding: 0..51 => suit * 13 + rank
// suit: 0=Clubs 1=Diamonds 2=Hearts 3=Spades
// rank: 0='2' .. 12='A'

export type Card = number;
export type SuitIdx = 0 | 1 | 2 | 3;
export type Seat = 0 | 1 | 2 | 3; // 0=South(You) 1=West 2=North(Partner) 3=East

export const SPADES: SuitIdx = 3;

export const suitOf = (c: Card): SuitIdx => ((c / 13) | 0) as SuitIdx;
export const rankOf = (c: Card): number => c % 13;
export const makeCard = (s: SuitIdx, r: number): Card => s * 13 + r;

export const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_LABEL = ['♣', '♦', '♥', '♠'];
export const SUIT_NAME = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
export const SUIT_IS_RED = [false, true, true, false];

export const SEAT_NAME = ['You', 'West', 'Partner', 'East'];
export const SEAT_SHORT = ['S', 'W', 'N', 'E'];

export const nextSeat = (s: Seat): Seat => ((s + 1) % 4) as Seat;
export const partnerOf = (s: Seat): Seat => ((s + 2) % 4) as Seat;
export const teamOf = (s: Seat): 0 | 1 => (s % 2) as 0 | 1;

export const cardName = (c: Card): string => RANK_LABEL[rankOf(c)] + SUIT_LABEL[suitOf(c)];
export const cardNameLong = (c: Card): string =>
  `${RANK_LABEL[rankOf(c)]} of ${SUIT_NAME[suitOf(c)]}`;

export const fullDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);

/** Sort for display: spades first (high to low), then hearts, diamonds, clubs. */
const DISPLAY_SUIT_ORDER: Record<number, number> = { 3: 0, 2: 1, 1: 2, 0: 3 };
export function sortForDisplay(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const sa = DISPLAY_SUIT_ORDER[suitOf(a)];
    const sb = DISPLAY_SUIT_ORDER[suitOf(b)];
    if (sa !== sb) return sa - sb;
    return rankOf(b) - rankOf(a);
  });
}

// ---- deterministic RNG (mulberry32) so evaluations are reproducible ----
export type RNG = () => number;
export function makeRng(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: RNG): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealDeck(rng: RNG): Card[][] {
  const d = shuffle(fullDeck(), rng);
  return [d.slice(0, 13), d.slice(13, 26), d.slice(26, 39), d.slice(39, 52)];
}
