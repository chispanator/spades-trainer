# Spades Trainer

A playable game of spades that grades every decision you make.

You sit South with a simulated partner and two opponents. After each bid and each
card, the app runs a Monte Carlo search over the hands your opponents could
plausibly be holding, works out what every legal alternative was worth, and tells
you what your choice cost — with the reasoning spelled out in words.

## How the coaching works

There is no opening book and no hand-written table of "right answers". Every
verdict comes from simulating the rest of the hand.

1. **Build the information set.** The engine knows only what you know: your own
   cards, every card played so far, and which players have shown out of a suit
   (`lib/spades/inference.ts`). Nothing else about the opponents' hands is used.
2. **Deal the unseen cards.** Each sample deals the remaining cards into a layout
   consistent with those constraints, most-constrained cards placed first.
3. **Try every legal card against that same layout.** Using common random
   numbers means two cards are compared on identical deals, so the difference
   between them is far less noisy than evaluating each on its own.
4. **Play the hand out** with a fast rollout policy for all four seats and score
   the result with the real scoring rules — contract, bags, nil and all.
5. **Grade against the engine's own error bars.** The gap between your card and
   the best card is reported with a paired standard error, and a play is only
   called a mistake when the gap clears that noise. Values are in "points", where
   one point is ten spades score points, so roughly one meaningful trick.

The explanations are generated separately by reading the position — partner
already winning the trick, contract already made, a live nil, a ruffing chance,
leading away from an honour — so the feedback says *why*, not just *how much*.

Grades are calibrated against measured data rather than guesswork. A competent
rollout policy gives up 0.00 points at the median decision, 0.68 at the 90th
percentile and 1.71 at the 97th; the thresholds in `lib/spades/coach.ts` sit on
that scale.

## Rules implemented

Standard partnership spades. Follow suit if you can, spades are trumps, and no
one may lead a spade until one has been played. Making your side's combined bid
scores ten a trick, missing it loses the same. Overtricks are bags worth one
point each, and ten bags cost 100. Nil is +100 made and -100 failed; a busted
nil's tricks count toward the partner's contract.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Checking it

The engine has a headless test suite that does not need a browser.

```bash
npx tsx scripts/selftest.ts
```

This verifies the rules invariants over hundreds of random hands, checks the
scoring table by hand, confirms the evaluator ranks a known blunder last with a
statistically significant margin, measures how stable the Monte Carlo picks are
at different sample counts, and prints the loss distribution used to calibrate
the grades.

```bash
npx tsx scripts/playtest.ts
```

This drives a whole game through the state machine with no UI, asserting that
every hand has thirteen tricks and that every decision is reviewed, and reports
coach latency.

## Layout

```
lib/spades/
  cards.ts       card encoding, seats, deterministic RNG
  rules.ts       legal moves, trick winner, scoring
  playstate.ts   the cheap state the simulation mutates
  policy.ts      the rollout policy used inside a playout
  inference.ts   voids shown, and constrained dealing of unseen cards
  mc.ts          the Monte Carlo evaluator and bid estimator
  coach.ts       grading and the written explanations
  game.ts        full game state machine and the opponents
components/      table, hand, coaching panels
app/page.tsx     wiring and turn timing
```

Everything runs in the browser; there is no backend and no network call.
