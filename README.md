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
5. **Run the survivors again.** A cheap first round only decides which cards are
   still in contention; the deals saved on the rest are spent on the short list,
   where the gaps are small enough to need them.
6. **Grade against the engine's own error bars.** The gap between your card and
   the best card is reported with a paired standard error, and a play is only
   called a mistake when the gap clears that noise. Values are in "points", where
   one point is ten spades score points, so roughly one meaningful trick.

## Advice the engine can stand behind

An engine that ranks its candidates by expected value and reads off the top row
will, sooner or later, tell you to throw away an ace. Not because it thinks the
ace is worthless — because the plays it was choosing between were level, and
inside its own margin of error the ranking is not a finding, it is whichever
card drew the friendlier deals. With a live nil at the table the swing on a
single deal is ten times the gap between two sensible discards, so "level" is
the normal case, not an edge case.

So the top row is not the advice. Three rules stand between the simulation and
what you are told:

- **Nothing is recommended unless it can be proved better than what you played.**
  Not ranked above it — proved, by a gap that clears the noise.
- **The proof is tested on deals it was not chosen on.** The run is split in
  half: one half picks the claim, the other half has to confirm it. Choosing the
  best-looking card and then testing it against the samples that made it look
  best is the oldest way there is to find an effect that is not there, and it
  was worth about one false verdict in six here.
- **Where plays are genuinely level, the tie goes to judgement, not to sampling
  error.** Among cards the engine values equally, part with the one you would
  least miss: not a trump, not the highest card of its suit still unplayed, not
  the last guard on a king — and on nil, exactly the opposite (`judgment.ts`).

The visible result is that "the engine leans to A♦, but the gap is inside its
margin of error" is no longer something the app can say. If the gap is inside
the margin, there is no lean to report.

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

### "Always cash your aces"

The most common rule players bring to spades, and the guarantee behind it is
real. `scripts/acetest.ts` measures it over 161 random deals where South is on
lead holding a side-suit ace:

```
  ace lead is the engine's top choice: 6% of the time
  cost of following the rule: mean 0.71, median 0.63, p90 1.42
  total tricks our side takes: 6.71 leading the ace vs 6.86 otherwise

  leading the ace now      : wins its trick 96.4%, trumped 3.6%
  leading the engine's card: the ace still wins 83.5%, trumped 16.0%
```

So the rule is right about what it claims — cashing the ace does convert it from
an 84% trick into a 96% one, and holding it risks a 16% ruff. It is wrong about
what that is worth. Winning the trick leaves you on lead, and the side that
opens a suit tends to give a trick away in it; the 0.13 of a trick gained on the
ace is paid for twice over elsewhere, which shows up as **fewer total tricks**
(6.71 against 6.86). That the total moves the wrong way is what rules out a
scoring quirk.

The exception the data does support: an ace **with the king** behind it is a far
better lead (top choice 15% of the time, mean cost 0.37) than a bare ace (3%,
0.85), because there the lead sets up a second trick instead of just banking one.

One caveat stated plainly: this is the engine's model, and the size of the
penalty depends on how well the rollout policy handles being on lead. The
direction is corroborated independently by the K-J-x result above, but treat
0.71 as an estimate rather than a constant of nature.

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

It also pins one discard position from both ends. Partner leads the ace of
hearts and is winning the trick, South is void and holding the ace of diamonds,
and West is on nil: across six seeds, throwing the ace is never the advice and
the cheap discard is never marked down for keeping it. The same section checks
the other direction, because refusing to advise inside the noise must not turn
into refusing to advise at all — the king thrown under partner's ace is still
called the mistake it is, with a cost the player can see.

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
  mc.ts          the Monte Carlo evaluator, the two rounds, and the statistics
  judgment.ts    what a card is worth keeping, for ties the simulation cannot call
  coach.ts       grading and the written explanations
  game.ts        full game state machine and the opponents
components/      table, hand, coaching panels
app/page.tsx     wiring and turn timing
```

Everything runs in the browser; there is no backend and no network call.
