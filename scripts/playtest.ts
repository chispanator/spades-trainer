/**
 * End-to-end drive of the game state machine, with no UI involved.
 *   npx tsx scripts/playtest.ts
 */
import { Seat, cardName, SEAT_NAME } from '../lib/spades/cards';
import {
  GameState,
  aiBid,
  aiChooseCard,
  attachBidReview,
  dealNextHand,
  newGame,
  playCard,
  resolveTrick,
  reviewHumanBid,
  reviewHumanPlay,
  sessionStats,
  submitBid,
} from '../lib/spades/game';
import { GRADE_LABEL } from '../lib/spades/coach';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const t0 = Date.now();
let g: GameState = newGame({ seed: 20260822, targetScore: 250, difficulty: 'intermediate', allowNil: true });

let handsPlayed = 0;
let guard = 0;
const allReviews = [];
let coachCalls = 0;
let coachMs = 0;

while (g.phase !== 'gameComplete' && guard++ < 6000) {
  if (g.phase === 'bidding') {
    if (g.turn === 0) {
      const bid = aiBid(g, 0);
      const t = Date.now();
      const br = reviewHumanBid(g, bid);
      coachMs += Date.now() - t;
      coachCalls++;
      g = attachBidReview(g, br);
      g = submitBid(g, 0, bid);
    } else {
      g = submitBid(g, g.turn, aiBid(g, g.turn));
    }
    continue;
  }

  if (g.phase === 'playing') {
    const seat = g.turn as Seat;
    const before = g.hands[seat].length;
    if (seat === 0) {
      const card = aiChooseCard(g, 0);
      const t = Date.now();
      const review = reviewHumanPlay(g, card);
      coachMs += Date.now() - t;
      coachCalls++;
      g = playCard(g, card, review);
    } else {
      g = playCard(g, aiChooseCard(g, seat));
    }
    if (g.hands[seat].length !== before - 1) {
      check(false, 'card left the hand', `${SEAT_NAME[seat]}`);
      break;
    }
    continue;
  }

  if (g.phase === 'trickComplete') {
    check(g.trick.length === 4, 'completed trick holds four cards');
    g = resolveTrick(g);
    continue;
  }

  if (g.phase === 'handComplete') {
    const r = g.lastHand!;
    handsPlayed++;
    const totalTricks = r.tricksWon.reduce((a, b) => a + b, 0);
    if (totalTricks !== 13) check(false, 'hand had 13 tricks', String(totalTricks));
    allReviews.push(...r.reviews);
    console.log(
      `  hand ${r.handNumber}: bids ${r.bids.join('/')} tricks ${r.tricksWon.join('/')} ` +
        `score ${r.handScore[0] >= 0 ? '+' : ''}${r.handScore[0]} / ${r.handScore[1] >= 0 ? '+' : ''}${r.handScore[1]} ` +
        `totals ${r.totals[0]}-${r.totals[1]}`
    );
    g = dealNextHand(g);
    continue;
  }

  check(false, 'unexpected phase', g.phase);
  break;
}

console.log('');
check(g.phase === 'gameComplete', 'game reached a winner', `${g.scores[0]} - ${g.scores[1]}`);
check(handsPlayed > 0 && handsPlayed < 60, 'played a sane number of hands', String(handsPlayed));
check(
  g.history.every((h) => h.tricksWon.reduce((a, b) => a + b, 0) === 13),
  'every hand in history has 13 tricks'
);
check(
  g.history.every((h) => h.reviews.length === 13),
  'the human seat was reviewed on all 13 tricks of every hand',
  String(g.history.map((h) => h.reviews.length).join(','))
);

const stats = sessionStats(allReviews);
console.log(
  `\n  ${allReviews.length} plays reviewed, ${stats.totalDecisions} with a real choice.`
);
console.log(
  `  ${Object.entries(stats.counts)
    .map(([k, v]) => `${GRADE_LABEL[k as keyof typeof GRADE_LABEL]} ${v}`)
    .join(' | ')}`
);
console.log(`  average EV given up per decision: ${(stats.totalLoss / Math.max(1, stats.totalDecisions)).toFixed(3)} pts`);
console.log(`  coach latency: ${(coachMs / Math.max(1, coachCalls)).toFixed(0)}ms average over ${coachCalls} calls`);
console.log(`  total wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const worst = allReviews
  .filter((r) => r.hadChoice)
  .sort((a, b) => b.loss - a.loss)
  .slice(0, 3);
console.log('\n  worst three decisions:');
for (const r of worst) {
  console.log(`   trick ${r.trickNumber}: played ${cardName(r.played)}, best ${cardName(r.best)} (-${r.loss.toFixed(2)})`);
  console.log(`     ${r.headline}`);
  for (const n of r.notes) console.log(`       - ${n}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
