/**
 * "Always lead an ace you hold" — how good is that rule, really?
 *   npx tsx scripts/acetest.ts
 *
 * Deals many random hands where South is on lead holding at least one side-suit
 * ace, bids them realistically, and compares leading the best ace against what
 * the engine would lead. Segments the answer by how long the ace's suit is and
 * by what else is in the hand, so the exceptions can be described rather than
 * hand-waved.
 */
import {
  Card,
  SUIT_NAME,
  Seat,
  cardName,
  dealDeck,
  makeRng,
  rankOf,
  sortForDisplay,
  suitOf,
} from '../lib/spades/cards';
import { estimateTricks, evaluatePlays } from '../lib/spades/mc';
import { dealUnseen, emptyVoids } from '../lib/spades/inference';
import { PlayState, applyCard, isTerminal } from '../lib/spades/playstate';
import { heuristicChoice } from '../lib/spades/policy';
import { TrickCard, winningIndex } from '../lib/spades/rules';
import { reviewPlay } from '../lib/spades/coach';

const DEALS = 260;
const SAMPLES = 500;
const rng = makeRng(31337);

interface Row {
  loss: number;
  aceIsBest: boolean;
  suitLen: number;
  hasKing: boolean;
  spades: number;
  aceCard: Card;
  bestCard: Card;
  hand: Card[];
  bids: number[];
  aceTricks: number;
  bestTricks: number;
}

const rows: Row[] = [];

for (let d = 0; d < DEALS && rows.length < DEALS; d++) {
  const hands = dealDeck(rng);
  const myHand = hands[0];
  const sideAces = myHand.filter((c) => rankOf(c) === 12 && suitOf(c) !== 3);
  if (!sideAces.length) continue;

  // Realistic bids from each seat's own view of its cards.
  const bids = [0, 1, 2, 3].map((s) =>
    Math.max(1, Math.round(estimateTricks(hands[s], s as Seat, 0 as Seat, 50, d * 17 + s).expected))
  );

  const unseen: Card[] = [];
  const mine = new Set(myHand);
  for (let c = 0; c < 52; c++) if (!mine.has(c)) unseen.push(c);

  const res = evaluatePlays(
    {
      info: { observer: 0 as Seat, hand: myHand, handSizes: [13, 13, 13, 13], voids: emptyVoids(), unseen },
      bids,
      trick: [],
      tricksWon: [0, 0, 0, 0],
      spadesBroken: false,
      bagsBefore: [0, 0],
    },
    SAMPLES,
    d * 7919
  );

  const evOf = (c: Card) => res.candidates.find((x) => x.card === c)!.ev;
  // The player's rule says lead an ace; give the rule its best shot.
  const bestAce = sideAces.reduce((a, b) => (evOf(b) > evOf(a) ? b : a));
  const best = res.candidates[0];

  const suit = suitOf(bestAce);
  rows.push({
    loss: best.ev - evOf(bestAce),
    aceIsBest: best.card === bestAce,
    suitLen: myHand.filter((c) => suitOf(c) === suit).length,
    hasKing: myHand.some((c) => suitOf(c) === suit && rankOf(c) === 11),
    spades: myHand.filter((c) => suitOf(c) === 3).length,
    aceCard: bestAce,
    bestCard: best.card,
    hand: myHand,
    bids,
    aceTricks: res.candidates.find((x) => x.card === bestAce)!.avgTeamTricks,
    bestTricks: best.avgTeamTricks,
  });
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const losses = rows.map((r) => r.loss);
console.log(`${rows.length} deals where South leads holding a side-suit ace\n`);
console.log(`  ace lead is the engine's top choice: ${((rows.filter((r) => r.aceIsBest).length / rows.length) * 100).toFixed(0)}% of the time`);
console.log(`  cost of following the rule: mean ${mean(losses).toFixed(2)}, median ${q(losses, 0.5).toFixed(2)}, p75 ${q(losses, 0.75).toFixed(2)}, p90 ${q(losses, 0.9).toFixed(2)}, worst ${q(losses, 1).toFixed(2)}`);
console.log(`  within a coaching "inaccuracy" (<=1.0): ${((losses.filter((l) => l <= 1).length / losses.length) * 100).toFixed(0)}%`);

// Robustness check: if leading the ace secures a trick yet our side ends up
// with FEWER tricks overall, the cost is structural rather than a scoring quirk.
console.log(
  `  total tricks our side takes: ${mean(rows.map((r) => r.aceTricks)).toFixed(2)} leading the ace ` +
    `vs ${mean(rows.map((r) => r.bestTricks)).toFixed(2)} leading the engine's card`
);

function segment(label: string, pick: (r: Row) => boolean) {
  const sub = rows.filter(pick);
  if (sub.length < 8) return;
  const l = sub.map((r) => r.loss);
  console.log(
    `  ${label.padEnd(30)} n=${String(sub.length).padStart(3)}  best ${((sub.filter((r) => r.aceIsBest).length / sub.length) * 100).toFixed(0).padStart(3)}%  mean loss ${mean(l).toFixed(2)}  p90 ${q(l, 0.9).toFixed(2)}`
  );
}

console.log('\nby length of the ace\'s suit:');
segment('doubleton or shorter (<=2)', (r) => r.suitLen <= 2);
segment('three cards', (r) => r.suitLen === 3);
segment('four cards', (r) => r.suitLen === 4);
segment('five or more', (r) => r.suitLen >= 5);

console.log('\nby what else is in the hand:');
segment('ace with the king', (r) => r.hasKing);
segment('ace without the king', (r) => !r.hasKing);
segment('short in spades (<=2)', (r) => r.spades <= 2);
segment('long in spades (>=5)', (r) => r.spades >= 5);

/*
  The rule's real claim is "an ace guarantees a trick, so cash it". The number
  above only says the ace lead scores worse, which could just mean "cash it one
  trick later". So measure the claim head on: if you do NOT lead the ace now,
  does it still win a trick later, or does somebody trump it?
*/
function aceFate(hand: Card[], bids: number[], ace: Card, lead: Card, samples: number, seed: number) {
  const r = makeRng(seed);
  const unseen: Card[] = [];
  const mine = new Set(hand);
  for (let c = 0; c < 52; c++) if (!mine.has(c)) unseen.push(c);
  const info = { observer: 0 as Seat, hand, handSizes: [13, 13, 13, 13], voids: emptyVoids(), unseen };

  let won = 0;
  let trumped = 0;
  for (let s = 0; s < samples; s++) {
    const st: PlayState = {
      hands: dealUnseen(info, r),
      bids,
      turn: 0,
      trick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      bagsBefore: [0, 0],
    };
    let guard = 0;
    let settled = false;
    while (!isTerminal(st) && guard++ < 64) {
      const actor = st.turn;
      const before = st.trick.slice();
      const card = guard === 1 ? lead : heuristicChoice(st);
      applyCard(st, card);
      if (st.trick.length === 0) {
        const full: TrickCard[] = [...before, { seat: actor, card }];
        if (!settled && full.some((t) => t.card === ace)) {
          settled = true;
          const w = full[winningIndex(full)];
          if (w.seat === 0 || w.seat === 2) won++;
          else if (suitOf(w.card) === 3 && suitOf(full[0].card) !== 3) trumped++;
        }
      }
    }
  }
  return { won: won / samples, trumped: trumped / samples };
}

console.log('\nif you do not lead the ace now, does it still win?');
{
  const sub = rows.slice(0, 60);
  let leadNowWon = 0, leadNowTrumped = 0, holdWon = 0, holdTrumped = 0;
  sub.forEach((r, i) => {
    const a = aceFate(r.hand, r.bids, r.aceCard, r.aceCard, 200, 900 + i);
    const b = aceFate(r.hand, r.bids, r.aceCard, r.bestCard, 200, 900 + i);
    leadNowWon += a.won; leadNowTrumped += a.trumped;
    holdWon += b.won; holdTrumped += b.trumped;
  });
  const n = sub.length;
  console.log(`  leading the ace now      : wins its trick ${((leadNowWon / n) * 100).toFixed(1)}%, trumped ${((leadNowTrumped / n) * 100).toFixed(1)}%`);
  console.log(`  leading the engine's card: the ace still wins ${((holdWon / n) * 100).toFixed(1)}%, trumped ${((holdTrumped / n) * 100).toFixed(1)}%`);
}

console.log('\nthe five worst cases for the rule:');
for (const r of [...rows].sort((a, b) => b.loss - a.loss).slice(0, 5)) {
  console.log(
    `  -${r.loss.toFixed(2)}  led ${cardName(r.aceCard)} (${SUIT_NAME[suitOf(r.aceCard)]} ${r.suitLen} long), engine leads ${cardName(r.bestCard)}`
  );
  console.log(`         bids ${r.bids.join('/')}  hand ${sortForDisplay(r.hand).map(cardName).join(' ')}`);
}

// ---- what the player is actually told when they follow the rule ----
{
  const worst = [...rows].sort((a, b) => b.loss - a.loss)[0];
  const unseen: Card[] = [];
  const mine = new Set(worst.hand);
  for (let c = 0; c < 52; c++) if (!mine.has(c)) unseen.push(c);
  const res = evaluatePlays(
    {
      info: { observer: 0 as Seat, hand: worst.hand, handSizes: [13, 13, 13, 13], voids: emptyVoids(), unseen },
      bids: worst.bids,
      trick: [],
      tricksWon: [0, 0, 0, 0],
      spadesBroken: false,
      bagsBefore: [0, 0],
    },
    3000
  );
  const review = reviewPlay(
    {
      seat: 0 as Seat,
      hand: worst.hand,
      trick: [],
      bids: worst.bids,
      tricksWon: [0, 0, 0, 0],
      spadesBroken: false,
      trickNumber: 1,
    },
    worst.aceCard,
    res
  );
  console.log('\n--- what the player is shown after leading the ace ---');
  console.log(review.headline);
  for (const n of review.notes) console.log(`  - ${n}`);
}
