/**
 * Does the simulation agree with how players actually count a hand?
 *   npx tsx scripts/handcount.ts
 *
 * Two pieces of common table wisdom get checked against the engine:
 *   - a long side suit is worth far less than its length, because the other
 *     three seats run out of it and start trumping;
 *   - a void or singleton is worth tricks in *spades*, not in that suit.
 */
import { Card, SUIT_NAME, Seat, cardName, sortForDisplay } from '../lib/spades/cards';
import { estimateTricks } from '../lib/spades/mc';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const SAMPLES = 1500;

function report(title: string, hand: Card[]) {
  const est = estimateTricks(hand, 0 as Seat, 1 as Seat, SAMPLES, 4242);
  console.log(`\n${title}`);
  console.log(`  ${sortForDisplay(hand).map(cardName).join(' ')}`);
  console.log(`  suit         held   tricks`);
  for (let s = 3; s >= 0; s--) {
    if (!est.lengths[s]) continue;
    const extra = s === 3 && est.ruffs >= 0.05 ? `   (${est.ruffs.toFixed(1)} of them by ruffing)` : '';
    console.log(
      `  ${SUIT_NAME[s].padEnd(10)} ${String(est.lengths[s]).padStart(5)} ${est.bySuit[s].toFixed(1).padStart(8)}${extra}`
    );
  }
  console.log(`  total expected: ${est.expected.toFixed(2)} tricks`);
  const summed = est.bySuit.reduce((a, b) => a + b, 0);
  check(Math.abs(summed - est.expected) < 0.01, 'per-suit tricks sum to the total', `${summed.toFixed(2)}`);
  return est;
}

// A long, weak side suit: seven diamonds headed by the eight.
const longSuit = [13, 14, 15, 16, 17, 18, 19, 39, 40, 38, 37, 12, 11];
const a = report('A. Seven low diamonds — does length pay?', longSuit);
check(
  a.bySuit[1] < 2,
  'seven low diamonds yield under 2 diamond tricks',
  `${a.bySuit[1].toFixed(2)}`
);
check(
  a.bySuit[1] < a.lengths[1] / 2,
  'the long suit returns less than half its length',
  `${a.bySuit[1].toFixed(2)} from ${a.lengths[1]} cards`
);

// A void, with middling spades to ruff with.
const voidHand = [47, 46, 45, 44, 43, 26, 27, 28, 29, 13, 14, 15, 16];
const b = report('B. Void in clubs, five middling spades — does shortness pay?', voidHand);
check(b.ruffs >= 0.5, 'the void generates ruffing tricks', `${b.ruffs.toFixed(2)} ruffs`);
check(b.bySuit[0] === 0, 'no tricks come from the suit it is void in');

// A flat hand with honours spread around.
const flat = [51, 50, 49, 38, 37, 26, 25, 13, 14, 12, 0, 1, 2];
const c = report('C. Flat 3-3-3-4 with honours — where do the tricks come from?', flat);
check(c.bySuit[3] >= 2, 'three top spades are worth at least 2 tricks', `${c.bySuit[3].toFixed(2)}`);

console.log('');
console.log(
  failures === 0
    ? 'ALL CHECKS PASSED — the engine counts a hand the way the table does.'
    : `${failures} CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
