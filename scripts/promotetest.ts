/**
 * Does leading the jack from K-J-x to force out the ace actually pay?
 *   npx tsx scripts/promotetest.ts
 *
 * South is on lead holding K J 4 of hearts with no ace. The classic plan is to
 * lead the jack, draw the ace, and promote the king. This prints what the
 * simulation thinks each lead is worth *and* how many heart tricks the side
 * actually ends up taking, so the plan can be judged on its own terms rather
 * than on a bare expected-value number.
 */
import { Card, SUIT_NAME, Seat, cardName, sortForDisplay, suitOf } from '../lib/spades/cards';
import { evaluatePlays } from '../lib/spades/mc';
import { reviewPlay } from '../lib/spades/coach';
import { emptyVoids } from '../lib/spades/inference';

/** Every card not in this hand - before a card is played, that is the other three seats. */
function unseenFor(hand: Card[]): Card[] {
  const mine = new Set(hand);
  const out: Card[] = [];
  for (let c = 0; c < 52; c++) if (!mine.has(c)) out.push(c);
  return out;
}

const KH = 37, JH = 35, H4 = 28;
const HAND: Card[] = [
  KH, JH, H4, // K J 4 of hearts - the holding under test
  12, 4, 1, // A 6 3 of clubs
  49, 45, 42, 39, // Q 8 5 2 of spades
  20, 16, 13, // 9 5 2 of diamonds
];

const unseen: Card[] = [];
const mine = new Set(HAND);
for (let c = 0; c < 52; c++) if (!mine.has(c)) unseen.push(c);

const res = evaluatePlays(
  {
    info: {
      observer: 0 as Seat,
      hand: HAND,
      handSizes: [13, 13, 13, 13],
      voids: emptyVoids(),
      unseen,
    },
    bids: [3, 3, 3, 4],
    trick: [],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    bagsBefore: [0, 0],
  },
  4000
);

console.log(`hand: ${sortForDisplay(HAND).map(cardName).join(' ')}`);
console.log('south leads, spades not broken, we bid 3 and partner bid 3\n');
console.log('  lead    ev      our heart tricks   our total   make%');
for (const c of res.candidates) {
  console.log(
    `  ${cardName(c.card).padEnd(5)} ${c.ev.toFixed(2).padStart(6)} ` +
      `${c.suitTricks[2].toFixed(2).padStart(15)} ` +
      `${c.avgTeamTricks.toFixed(2).padStart(11)} ` +
      `${(c.makeProb * 100).toFixed(0).padStart(7)}%`
  );
}

const by = (card: Card) => res.candidates.find((c) => c.card === card)!;
const best = res.candidates[0];
const hearts = res.candidates.filter((c) => suitOf(c.card) === 2);
const bestHeart = hearts[0];

console.log('');
console.log(`best lead overall: ${cardName(best.card)} (${SUIT_NAME[suitOf(best.card)]})`);
console.log(`best heart lead:   ${cardName(bestHeart.card)}  ev ${bestHeart.ev.toFixed(2)}`);
console.log('');
console.log('Decomposing the jack-of-hearts lead:');
console.log(`  choosing hearts at all costs : ${(best.ev - bestHeart.ev).toFixed(2)} pts`);
console.log(`  the card chosen within hearts: ${(bestHeart.ev - by(JH).ev).toFixed(2)} pts`);
console.log('');
console.log('Do we get more heart tricks by leading hearts?');
console.log(`  after leading ${cardName(JH)}: ${by(JH).suitTricks[2].toFixed(2)} heart tricks`);
console.log(`  after leading ${cardName(best.card)}: ${best.suitTricks[2].toFixed(2)} heart tricks`);
console.log(
  by(JH).suitTricks[2] > best.suitTricks[2] + 0.05
    ? '  -> the promotion plan does bring in extra heart tricks; the cost is elsewhere.'
    : '  -> leading hearts does NOT bring in more heart tricks than leaving the suit alone.'
);

// ---- and what the coach actually tells the player ----
const review = reviewPlay(
  {
    seat: 0 as Seat,
    hand: HAND,
    trick: [],
    bids: [3, 3, 3, 4],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    trickNumber: 1,
    unseen: unseenFor(HAND),
  },
  JH,
  res
);
console.log('\n--- what the player is shown ---');
console.log(review.headline);
for (const n of review.notes) console.log(`  - ${n}`);
