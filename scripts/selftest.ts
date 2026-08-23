/**
 * Engine self-test and calibration.
 *   npx tsx scripts/selftest.ts
 *
 * Checks the rules invariants, measures Monte Carlo stability, and prints the
 * distribution of "EV lost" so the grading thresholds in lib/spades/coach.ts
 * can be set against real numbers rather than guesses.
 */
import { Card, Seat, cardName, dealDeck, makeRng, sortForDisplay, suitOf } from '../lib/spades/cards';
import { legalMoves, scoreTeamHand } from '../lib/spades/rules';
import { PlayState, applyCard, isTerminal } from '../lib/spades/playstate';
import { heuristicChoice } from '../lib/spades/policy';
import { bidBreakdown, estimateTricks, evaluatePlays, pairedDifference } from '../lib/spades/mc';
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

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
