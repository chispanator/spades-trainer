/**
 * Engine self-test and calibration.
 *   npx tsx scripts/selftest.ts
 *
 * Checks the rules invariants, measures Monte Carlo stability, and prints the
 * distribution of "EV lost" so the grading thresholds in lib/spades/coach.ts
 * can be set against real numbers rather than guesses.
 */
import { Card, Seat, cardName, dealDeck, makeRng, sortForDisplay, suitOf } from '../lib/spades/cards';
import { TrickCard, legalMoves, scoreTeamHand } from '../lib/spades/rules';
import { PlayState, applyCard, isTerminal } from '../lib/spades/playstate';
import { heuristicChoice } from '../lib/spades/policy';
import {
  bidBreakdown,
  estimateTricks,
  evaluatePlays,
  evaluateWithRunoff,
  pairedDifference,
} from '../lib/spades/mc';
import { isSureWinner, keepValue, preferAmongEquals } from '../lib/spades/judgment';
import { PlaySituation, reviewPlay } from '../lib/spades/coach';
import { COACH_FINALISTS, COACH_RUNOFF, coachSamples } from '../lib/spades/game';
import { deriveVoids, emptyVoids } from '../lib/spades/inference';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1. rules --
{
  const rng = makeRng(7);
  let illegal = 0;
  let badCounts = 0;
  let earlySpadeLeads = 0;
  for (let g = 0; g < 400; g++) {
    const st: PlayState = {
      hands: dealDeck(rng),
      bids: [3, 3, 3, 4],
      turn: (g % 4) as Seat,
      trick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      bagsBefore: [0, 0],
    };
    let plays = 0;
    while (!isTerminal(st)) {
      const legal = legalMoves(st.hands[st.turn], st.trick, st.spadesBroken);
      const leading = st.trick.length === 0;
      const brokenBefore = st.spadesBroken;
      const hand = st.hands[st.turn];
      const hadNonSpade = hand.some((c) => suitOf(c) !== 3);
      const c = heuristicChoice(st);
      if (!legal.includes(c)) illegal++;
      if (leading && !brokenBefore && suitOf(c) === 3 && hadNonSpade) earlySpadeLeads++;
      applyCard(st, c);
      plays++;
    }
    if (plays !== 52 || st.tricksWon.reduce((a, b) => a + b, 0) !== 13) badCounts++;
  }
  check(illegal === 0, '400 hands: every card played was legal', `(${illegal} illegal)`);
  check(badCounts === 0, '400 hands: 52 cards and 13 tricks each', `(${badCounts} bad)`);
  check(earlySpadeLeads === 0, 'spades never led before broken', `(${earlySpadeLeads})`);
}

// -------------------------------------------------------------- 2. scoring --
{
  const s1 = scoreTeamHand([0, 2], [4, 0, 3, 0], [4, 0, 3, 0], 0);
  check(s1.score === 70 && s1.bagsEarned === 0, 'made 7 exactly = 70', JSON.stringify(s1.score));
  const s2 = scoreTeamHand([0, 2], [4, 0, 3, 0], [6, 0, 3, 0], 0);
  check(s2.score === 72 && s2.bagsEarned === 2, 'made 7 with 2 bags = 72');
  const s3 = scoreTeamHand([0, 2], [4, 0, 3, 0], [2, 0, 3, 0], 0);
  check(s3.score === -70 && !s3.madeContract, 'set on 7 = -70');
  const s4 = scoreTeamHand([0, 2], [0, 0, 4, 0], [0, 0, 4, 0], 0);
  check(s4.score === 140, 'nil made plus partner 4 = 140');
  // House rule: a busted nil's tricks count toward the partner's contract.
  // -100 for the nil, +40 for the made 4, +2 bags.
  const s5 = scoreTeamHand([0, 2], [0, 0, 4, 0], [2, 0, 4, 0], 0);
  check(s5.score === -58 && s5.bagsEarned === 2, 'busted nil tricks feed the partner contract', String(s5.score));
  const s6 = scoreTeamHand([0, 2], [3, 0, 3, 0], [5, 0, 4, 0], 8);
  check(s6.score === 60 - 100 + 3 && s6.bagsAfter === 1, '10-bag penalty fires and rolls over', String(s6.score));
}

// ------------------------------------------------------------ 3. inference --
{
  const voids = deriveVoids([
    [
      { seat: 0 as Seat, card: 12 },
      { seat: 1 as Seat, card: 25 },
      { seat: 2 as Seat, card: 5 },
      { seat: 3 as Seat, card: 7 },
    ],
  ]);
  check(voids[1][0] === true, 'seat that discarded is marked void in the led suit');
  check(voids[2][0] === false && voids[3][0] === false, 'seats that followed are not marked void');
}

// --------------------------------------------------------------- 4. bidding --
{
  const monster = [51, 50, 49, 48, 47, 38, 37, 25, 24, 12, 11, 10, 9];
  const bust = [0, 1, 2, 13, 14, 15, 26, 27, 28, 39, 40, 41, 3];
  const em = estimateTricks(monster, 0, 1, 300);
  const eb = estimateTricks(bust, 0, 1, 300);
  console.log(`      monster ${sortForDisplay(monster).map(cardName).join(' ')}`);
  console.log(`        sim ${em.expected.toFixed(2)} tricks, hand count ${bidBreakdown(monster).total.toFixed(1)}`);
  console.log(`      bust    ${sortForDisplay(bust).map(cardName).join(' ')}`);
  console.log(`        sim ${eb.expected.toFixed(2)} tricks, P(nil) ${(eb.nilProb * 100).toFixed(0)}%, hand count ${bidBreakdown(bust).total.toFixed(1)}`);
  check(em.expected > 8, 'monster hand estimates 8+ tricks');
  check(eb.expected < 1.5 && eb.nilProb > 0.4, 'bust hand estimates under 1.5 tricks and is a nil candidate');
}

// ------------------------------------------- 5. does the evaluator see it? --
// Partner already owns the trick with the ace of hearts and we play last with
// the king. Throwing the king under it should measurably lose value.
{
  const KH = 37;
  const AH = 38;
  const H3 = 27;
  const H4 = 28;
  const hands = dealDeck(makeRng(5150));

  /** Move `card` into `seat`'s hand, swapping out one of that seat's cards. */
  const place = (card: Card, seat: Seat) => {
    const from = hands.findIndex((h) => h.includes(card));
    if (from === seat) return;
    const swapOut = hands[seat][0];
    hands[from][hands[from].indexOf(card)] = swapOut;
    hands[seat][0] = card;
  };
  place(KH, 0);
  place(AH, 2);
  place(H3, 1);
  place(H4, 3);

  // West leads the 3, partner wins with the ace, East follows with the 4.
  const trick = [
    { seat: 1 as Seat, card: H3 },
    { seat: 2 as Seat, card: AH },
    { seat: 3 as Seat, card: H4 },
  ];
  for (const tc of trick) hands[tc.seat].splice(hands[tc.seat].indexOf(tc.card), 1);

  const myHand = hands[0];
  const seen = new Set<Card>([...myHand, ...trick.map((t) => t.card)]);
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);

  const res = evaluatePlays(
    {
      info: {
        observer: 0 as Seat,
        hand: myHand,
        handSizes: [0, 1, 2, 3].map((s) => hands[s].length),
        voids: emptyVoids(),
        unseen,
      },
      bids: [3, 3, 3, 4],
      trick,
      tricksWon: [0, 0, 0, 0],
      spadesBroken: false,
      bagsBefore: [0, 0],
    },
    800
  );
  const best = res.candidates[0];
  const kingRank = res.candidates.findIndex((c) => c.card === KH);
  const d = pairedDifference(res, best.card, KH);
  console.log(
    `      partner has the trick; best is ${cardName(best.card)} (ev ${best.ev.toFixed(2)}), K♥ ranks ${kingRank + 1}/${res.candidates.length}, costs ${d.mean.toFixed(2)} +/- ${(1.96 * d.stdError).toFixed(2)} pts`
  );
  check(res.candidates.every((c) => suitOf(c.card) === 2), 'evaluator only offers legal follows');
  check(kingRank > 0, 'wasting the king under partner’s ace is not the top play');
  check(d.mean > 1.96 * d.stdError, 'the cost of wasting the king is statistically real');
}

// -------------------------------------------------- 6. stability of picks --
{
  const rng = makeRng(42);
  const hands = dealDeck(rng);
  const myHand = hands[0];
  const unseen: Card[] = [];
  const mine = new Set(myHand);
  for (let c = 0; c < 52; c++) if (!mine.has(c)) unseen.push(c);
  const ctx = {
    info: { observer: 0 as Seat, hand: myHand, handSizes: [13, 13, 13, 13], voids: emptyVoids(), unseen },
    bids: [4, 3, 3, 3],
    trick: [],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    bagsBefore: [0, 0] as [number, number],
  };
  const truth = evaluatePlays(ctx, 4000, 1);
  const truthEv = new Map(truth.candidates.map((c) => [c.card, c.ev]));
  console.log('      reference (4000 samples):');
  for (const c of truth.candidates) {
    console.log(`        ${cardName(c.card).padEnd(4)} ev ${c.ev.toFixed(3)}  make ${(c.makeProb * 100).toFixed(0)}%`);
  }
  for (const samples of [150, 400, 800]) {
    let lost = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const r = evaluatePlays(ctx, samples, 1000 + i * 977);
      lost += truthEv.get(truth.candidates[0].card)! - truthEv.get(r.candidates[0].card)!;
    }
    console.log(`      samples=${String(samples).padStart(4)}: avg true EV given up by the pick = ${(lost / trials).toFixed(3)} pts`);
  }
}

// ------------------------------------------------------- 7. loss calibration --
// Play whole hands where South uses the rollout policy, and record how much EV
// the policy gives up per decision. This is the scale the grades sit on.
{
  const rng = makeRng(2024);
  const losses: number[] = [];
  for (let g = 0; g < 12; g++) {
    const dealt = dealDeck(rng);
    const bids = dealt.map((h, i) => Math.max(1, Math.round(estimateTricks(h, i as Seat, 1, 60, g * 31 + i).expected)));
    const st: PlayState = {
      hands: dealt.map((h) => h.slice()),
      bids,
      turn: 1,
      trick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      bagsBefore: [0, 0],
    };
    const played: { seat: Seat; card: Card }[][] = [];
    let current: { seat: Seat; card: Card }[] = [];
    while (!isTerminal(st)) {
      if (st.turn === 0) {
        const unseen: Card[] = [];
        const seen = new Set<Card>(st.hands[0]);
        for (const t of played) for (const tc of t) seen.add(tc.card);
        for (const tc of current) seen.add(tc.card);
        for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
        const res = evaluatePlays(
          {
            info: {
              observer: 0,
              hand: st.hands[0],
              handSizes: [0, 1, 2, 3].map((s) => st.hands[s].length),
              voids: deriveVoids(played),
              unseen,
            },
            bids,
            trick: current,
            tricksWon: st.tricksWon,
            spadesBroken: st.spadesBroken,
            bagsBefore: [0, 0],
          },
          200,
          g * 101 + played.length
        );
        const choice = heuristicChoice(st);
        const d = pairedDifference(res, res.candidates[0].card, choice);
        if (res.candidates.length > 1) losses.push(Math.max(0, d.mean));
      }
      const c = heuristicChoice(st);
      current.push({ seat: st.turn, card: c });
      applyCard(st, c);
      if (current.length === 4) {
        played.push(current);
        current = [];
      }
    }
  }
  losses.sort((a, b) => a - b);
  const q = (p: number) => losses[Math.min(losses.length - 1, Math.floor(p * losses.length))];
  console.log(`      ${losses.length} decisions by the rollout policy, EV given up per decision:`);
  console.log(
    `        median ${q(0.5).toFixed(2)}  p75 ${q(0.75).toFixed(2)}  p90 ${q(0.9).toFixed(2)}  p97 ${q(0.97).toFixed(2)}  max ${q(1).toFixed(2)}`
  );
  check(losses.length > 100, 'calibration collected enough decisions');
}

// ------------------------------------- 8. advice the engine can stand behind --
/*
  A discard position taken from a real game: partner leads the ace of hearts and
  is winning the trick, East follows small, South is void in hearts and has to
  throw something. South holds the ace of diamonds - the highest diamond nobody
  has played - alongside a fistful of spot cards.

  Throwing the ace away is the one play in the position that costs a trick for
  nothing, and it is exactly what an engine recommends when it sorts a dozen
  noisy estimates and reads off the top row. The gaps between the sensible
  discards are far smaller than the swing a live nil puts on a single deal, so
  the ordering among them is sampling error. These checks pin the two things
  that have to hold: the ace is never the advice, and the cheap discard is never
  marked down for it.
*/
{
  const card = (suit: number, rank: number): Card => suit * 13 + rank;
  const AH = card(2, 12);
  const H4 = card(2, 2);
  const AD = card(1, 12);
  const C6 = card(0, 4);
  const KS = card(3, 11);

  const hand: Card[] = [
    card(3, 11), card(3, 5), card(3, 2),
    card(1, 12), card(1, 8), card(1, 3), card(1, 1),
    card(0, 10), card(0, 7), card(0, 4), card(0, 2), card(0, 0),
  ];
  const trick = [
    { seat: 2 as Seat, card: AH },
    { seat: 3 as Seat, card: H4 },
  ];
  const seen = new Set<Card>([...hand, AH, H4]);
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
  const voids = emptyVoids();
  voids[0][2] = true; // South showed out of hearts

  const bids = [3, 0, 5, 3]; // West is on nil, which is where the variance comes from
  const ctx = {
    info: { observer: 0 as Seat, hand, handSizes: [12, 12, 12, 12], voids, unseen },
    bids,
    trick,
    tricksWon: [0, 0, 1, 0],
    spadesBroken: false,
    bagsBefore: [0, 0] as [number, number],
  };
  const sit: PlaySituation = {
    seat: 0,
    hand,
    trick,
    bids,
    tricksWon: [0, 0, 1, 0],
    spadesBroken: false,
    trickNumber: 2,
    unseen,
  };

  check(isSureWinner(AD, unseen), 'the ace of diamonds is read as the best diamond still out');
  check(!isSureWinner(C6, unseen), 'a spot card is not read as a winner');

  let advisedTheAce = 0;
  let markedDown = 0;
  const seeds = [4242, 1, 77, 909, 5150, 31337];
  for (const seed of seeds) {
    const res = evaluateWithRunoff(ctx, {
      samples: coachSamples(12),
      runoff: COACH_RUNOFF,
      finalists: COACH_FINALISTS,
      include: [C6],
      seed,
    });
    check(res.rowOf.has(C6), `the played card reaches the final round (seed ${seed})`);
    const review = reviewPlay(sit, C6, res);
    if (review.best === AD) advisedTheAce++;
    if (review.grade !== 'optimal') markedDown++;
  }
  check(advisedTheAce === 0, 'throwing the ace is never the advice', `(${advisedTheAce}/${seeds.length})`);
  check(markedDown === 0, 'the cheap discard is graded optimal', `(${markedDown}/${seeds.length} marked down)`);

  // The tiebreak itself, in isolation.
  const tctx = { seat: 0 as Seat, hand, trick, bids, unseen };
  const level = [AD, C6, KS, card(0, 10)];
  check(preferAmongEquals(level, tctx) === C6, 'among equals, the spot card goes and the ace stays');
  check(
    preferAmongEquals(level, { ...tctx, trick: [] }) === null,
    'and it declines to answer on a lead, where nothing is being thrown away'
  );
  /*
    The rule is about discards, and saying so is what keeps it from quietly
    becoming a hoarding bias. "Cannot prove it is worse" is not "worth the
    same", and at the deal counts the opponents run on almost nothing can be
    told apart - so a rule that answers every one of those by keeping the big
    cards back produces a table that dribbles out spot cards and cashes its
    aces on trick thirteen.
  */
  const D2 = card(1, 0);
  const KD = card(1, 11);
  const D4 = card(1, 2);
  check(
    preferAmongEquals([AD, card(1, 8)], { ...tctx, trick: [{ seat: 1 as Seat, card: D2 }] }) === null,
    'and declines again when a candidate could take the trick'
  );
  check(
    preferAmongEquals([AD, card(1, 1)], {
      ...tctx,
      trick: [
        { seat: 1 as Seat, card: D2 },
        { seat: 2 as Seat, card: KD },
        { seat: 3 as Seat, card: D4 },
      ],
    }) === card(1, 1),
    'but still ducks under a partner who already holds the trick'
  );
  check(keepValue(AD, tctx) > keepValue(KS, tctx), 'a sure winner outranks a trump that is not one');
  check(
    preferAmongEquals(level, { ...tctx, bids: [0, 3, 5, 3] }) === KS,
    'on nil the ranking inverts and the most dangerous card goes'
  );

  // Guarding: the small card next to a bare king is worth more than its rank.
  const guardHand = [card(1, 11), card(1, 1), card(0, 4), card(0, 2), card(0, 0)];
  const gctx = { ...tctx, hand: guardHand };
  check(
    preferAmongEquals([card(1, 1), card(0, 2)], gctx) === card(0, 2),
    'the last guard on a king is kept ahead of a spare spot card'
  );
}

// --------------------------------- 8b. how short can the short list be? ----
/*
  The first round only has to answer "which cards are still in this?", so it can
  be cheap - but not so cheap that the genuinely best card never reaches the
  round that would have found it. This is the sweep COACH_FINALISTS comes from:
  what matters is the width of the short list, not the deals spent picking it.
*/
{
  const positions: { ctx: Parameters<typeof evaluatePlays>[0]; legal: Card[] }[] = [];
  const rng = makeRng(4711);
  for (let d = 0; d < 300 && positions.length < 8; d++) {
    const dealt = dealDeck(rng);
    const bids = [3, 0, 5, 3]; // nil live, where the noise is worst
    const st: PlayState = {
      hands: dealt,
      bids,
      turn: 1,
      trick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      bagsBefore: [0, 0],
    };
    const done: TrickCard[][] = [];
    let cur: TrickCard[] = [];
    while (st.hands[0].length > 10 || st.turn !== 0 || st.trick.length !== 0) {
      if (st.hands[0].length <= 6) break;
      const actor = st.turn;
      const before = st.trick.slice();
      const c = heuristicChoice(st);
      applyCard(st, c);
      cur = [...before, { seat: actor, card: c }];
      if (st.trick.length === 0) {
        done.push(cur);
        cur = [];
      }
    }
    if (st.turn !== 0 || st.trick.length !== 0) continue;
    const hand = st.hands[0];
    const legal = legalMoves(hand, st.trick, st.spadesBroken);
    if (legal.length < 7) continue;
    const seen = new Set<Card>(hand);
    for (const t of done) for (const tc of t) seen.add(tc.card);
    const unseen: Card[] = [];
    for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
    positions.push({
      ctx: {
        info: {
          observer: 0 as Seat,
          hand,
          handSizes: [0, 1, 2, 3].map((x) => st.hands[x].length),
          voids: deriveVoids(done),
          unseen,
        },
        bids,
        trick: st.trick,
        tricksWon: st.tricksWon,
        spadesBroken: st.spadesBroken,
        bagsBefore: [0, 0],
      },
      legal,
    });
  }

  const truth = positions.map((p, i) => evaluatePlays(p.ctx, 2500, 90001 + i).candidates[0].card);
  const hitsAt = (cap: number) => {
    let hits = 0;
    positions.forEach((p, i) => {
      const first = evaluatePlays(p.ctx, coachSamples(p.legal.length), 5000 + i);
      const leader = first.candidates[0].card;
      const short: Card[] = [];
      for (const c of first.candidates) {
        if (c.card === leader) {
          short.push(c.card);
          continue;
        }
        if (short.length >= cap) break;
        const d = pairedDifference(first, leader, c.card);
        if (d.mean <= Math.max(0.1, 2.58 * d.stdError)) short.push(c.card);
      }
      if (short.includes(truth[i])) hits++;
    });
    return hits;
  };
  const narrow = hitsAt(3);
  const chosen = hitsAt(COACH_FINALISTS);
  console.log(
    `      short list keeps the best card: ${narrow}/${positions.length} at 3 finalists, ${chosen}/${positions.length} at ${COACH_FINALISTS}`
  );
  check(positions.length >= 5, 'sweep found enough wide-open positions', `(${positions.length})`);
  check(chosen >= positions.length - 1, 'the short list keeps the best card', `(${chosen}/${positions.length})`);
  check(chosen >= narrow, 'and a wider short list is never worse than a narrow one');
}

// --------------------------- 9. real mistakes are still called out --------
// The safety net on section 8: refusing to advise inside the noise must not
// turn into refusing to advise at all. The king thrown under partner's ace is
// a genuine error and has to survive the whole pipeline as one.
{
  const KH = 37;
  const AH = 38;
  const H3 = 27;
  const H4 = 28;
  const hands = dealDeck(makeRng(5150));
  const place = (c: Card, seat: Seat) => {
    const from = hands.findIndex((h) => h.includes(c));
    if (from === seat) return;
    const swapOut = hands[seat][0];
    hands[from][hands[from].indexOf(c)] = swapOut;
    hands[seat][0] = c;
  };
  place(KH, 0);
  place(AH, 2);
  place(H3, 1);
  place(H4, 3);
  const trick = [
    { seat: 1 as Seat, card: H3 },
    { seat: 2 as Seat, card: AH },
    { seat: 3 as Seat, card: H4 },
  ];
  for (const tc of trick) hands[tc.seat].splice(hands[tc.seat].indexOf(tc.card), 1);

  const hand = hands[0];
  const seen = new Set<Card>([...hand, ...trick.map((t) => t.card)]);
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
  const bids = [3, 3, 3, 4];
  const ctx = {
    info: {
      observer: 0 as Seat,
      hand,
      handSizes: [0, 1, 2, 3].map((s) => hands[s].length),
      voids: emptyVoids(),
      unseen,
    },
    bids,
    trick,
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    bagsBefore: [0, 0] as [number, number],
  };
  const legal = hand.filter((c) => suitOf(c) === 2).length;
  const res = evaluateWithRunoff(ctx, {
    samples: coachSamples(legal),
    runoff: COACH_RUNOFF,
    finalists: COACH_FINALISTS,
    include: [KH],
    seed: 5150,
  });
  const review = reviewPlay(
    { seat: 0, hand, trick, bids, tricksWon: [0, 0, 0, 0], spadesBroken: false, trickNumber: 1, unseen },
    KH,
    res
  );
  console.log(`      king under the ace: graded ${review.grade}, costs ${review.loss.toFixed(2)} pts, advice ${cardName(review.best)}`);
  check(review.best !== KH, 'the king under partner’s ace is still called an error');
  check(review.grade !== 'optimal', 'and it is still graded as one');
  check(review.loss > 0.1, 'with a cost the player can see', `(${review.loss.toFixed(2)})`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
