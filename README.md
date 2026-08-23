# Spades Trainer

**Play it: https://spades-trainer.vercel.app**

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
   the result — contract, bags, nil and all.
5. **Grade against the engine's own error bars.** The gap between your card and
   the best card is reported with a paired standard error, and a play is only
   called a mistake when the gap clears that noise. Values are in "points", where
   one point is ten spades score points, so roughly one meaningful trick.

## What it is actually maximising

This is the part that decides whether the engine plays like a good partner or
like a trick-grabber, so it is stated explicitly in `lib/spades/playstate.ts`.

- **Contract first.** Ten a trick for making the bid, the same lost for missing.
- **Setting the opponents counts the same as scoring yourself** (`OPPONENT_WEIGHT
  = 1`). Spades is a race, so a point they fail to score is worth a point you do.
  Putting them under their bid swings the score by roughly twice their contract,
  which is why the engine will happily take a bag to do it.
- **A bag is worth about -9, not +1** (`BAG_TRUE_COST`). An overtrick scores +1
  tonight, but every tenth bag costs 100, so amortised each one carries -10 on
  top of that +1. The correction cancels against the real -100 when the penalty
  fires, so a bag is valued the same whether the counter sits at 0 or at 9.

That last point matters more than it looks. Scoring bags at their face value of
+1 — which is what the hand score alone says — makes the engine treat every
overtrick as free money and grab tricks a good player would duck. The scoreboard
still uses the real rules; the correction applies only when *judging* a play.

`scripts/bagtest.ts` pins this down with two endgames that differ only in the
opponents' contract: the engine must duck the same ace in one and take it in the
other.

## Answering the plan, not just the card

When the engine's pick is in a different suit, "you should have led clubs" hides
two separate decisions. The coach splits them: what choosing that suit cost, and
what the card chosen *within* it cost. Quite often the second is zero — the
player read the suit correctly and only picked the wrong one to open.

It also answers deliberate plans on their own terms. Leading the jack from K-J-x
to force out the ace is a real plan, so the review compares how many tricks the
side ends up taking **in that suit** either way. In `scripts/promotetest.ts`,
South holds K J 4 of hearts on lead:

```
  lead    ev      our heart tricks
  9♦      2.54            1.33
  J♥      2.16            1.19
  K♥      1.79            1.06
```

The jack is the best heart by a clear margin, so the plan's internal logic is
sound. But leading hearts at all returns *fewer* heart tricks than leaving the
suit alone — the promotion does not pay for itself, and the coach says so with
those numbers rather than asserting a rule.

The explanations are generated separately by reading the position — partner
already winning the trick, contract already made, a live nil, a ruffing chance,
leading away from an honour — so the feedback says *why*, not just *how much*.

Grades are calibrated against measured data rather than guesswork. A competent
rollout policy gives up 0.00 points at the median decision, 0.68 at the 90th
percentile and 1.71 at the 97th; the thresholds in `lib/spades/coach.ts` sit on
that scale.

## Counting your hand

Before bidding you can write down, suit by suit, how many tricks you think the
hand is worth, and only then see what the simulation gets. The engine attributes
each simulated trick to the suit of the card that actually *won* it, and counts
separately how many came from ruffing, so the comparison lands in the same terms
a player thinks in.

That breakdown makes two pieces of table wisdom measurable, both pinned down in
`scripts/handcount.ts`:

- **Length is not tricks.** Seven diamonds headed by the eight return `0.0`
  diamond tricks. Holding seven means the other three seats are short, and once
  somebody is void they trump instead of following.
- **Shortness pays in trumps.** A club void alongside five middling spades is
  worth 2.8 spade tricks — 2.5 of them ruffs, and none of them in clubs.

The app tracks how far off your counts run across a session and whether you lean
optimistic or cautious, which is usually more useful than any single hand.

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

```bash
npx tsx scripts/bagtest.ts
```

Two endgames where South holds the same three cards and the same guaranteed
winner, and only the opponents' contract differs. A correctly weighted engine
ducks in one and grabs in the other; one that treats overtricks as free grabs in
both. Exits non-zero on failure.

```bash
npx tsx scripts/handcount.ts
```

Checks the per-suit trick attribution against how players actually count: that a
long weak side suit returns less than half its length, that a void produces
ruffing tricks in the spade column rather than in the suit itself, and that the
per-suit numbers sum to the total.

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
