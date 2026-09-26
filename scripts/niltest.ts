/**
 * Does your partner actually help when you bid nil?
 *   npx tsx scripts/niltest.ts
 *
 * Finds hands where South has a genuine nil, forces the nil bid, plays the hand
 * out with the real opponents, and measures the three things a nil partner is
 * supposed to do:
 *   - lead HIGH, so the nil bidder can shed a dangerous card under it;
 *   - overtake the nil bidder whenever they are stuck winning a trick;
 *   - and, overall, let the nil through.
 */
import { Card, Seat, rankOf } from '../lib/spades/cards';
import { beatsTrick, legalMoves, winningIndex } from '../lib/spades/rules';
import {
  Difficulty,
  GameState,
  aiBid,
  aiChooseCard,
  dealNextHand,
  newGame,
  playCard,
  resolveTrick,
  submitBid,
} from '../lib/spades/game';
import { estimateTricks } from '../lib/spades/mc';

const HANDS = 60;
const NIL = 0 as Seat;
const PARTNER = 2 as Seat;

interface Stats {
  hands: number;
  nilMade: number;
  leads: number;
  leadRankTotal: number;
  highLeads: number; // jack or better
  rescueChances: number; // nil bidder winning, partner still to play and able to take it
  rescuesTaken: number;
  dumpChances: number; // partner wins a trick the nil bidder plays into
}

/**
 * `difficulty` drives every AI seat at once, so comparing settings conflates
 * "better partner" with "better opponents". Choosing each seat's card through a
 * state whose difficulty is overridden lets the partner be varied on its own.
 */
function chooseAs(g: GameState, seat: Seat, d: Difficulty): Card {
  return aiChooseCard({ ...g, options: { ...g.options, difficulty: d } }, seat);
}

function run(difficulty: Difficulty, seed: number, partnerAs: Difficulty = difficulty): Stats {
  const s: Stats = {
    hands: 0,
    nilMade: 0,
    leads: 0,
    leadRankTotal: 0,
    highLeads: 0,
    rescueChances: 0,
    rescuesTaken: 0,
    dumpChances: 0,
  };
  let g: GameState = newGame({ seed, targetScore: 100000, difficulty, allowNil: true });
  let guard = 0;

  while (s.hands < HANDS && guard++ < 40000) {
    if (g.phase === 'bidding') {
      // Only study hands where nil is a real proposition.
      if (g.turn === NIL) {
        const est = estimateTricks(g.hands[NIL], NIL, g.turn, 120, seed + g.handNumber);
        if (est.nilProb < 0.45) {
          g = dealNextHand(g);
          continue;
        }
        g = submitBid(g, NIL, 0);
      } else {
        g = submitBid(g, g.turn, aiBid(g, g.turn));
      }
      continue;
    }

    if (g.phase === 'playing') {
      const seat = g.turn;
      const nilAlive = g.tricksWon[NIL] === 0;

      if (seat === PARTNER && nilAlive) {
        const legal = legalFor(g, PARTNER);
        if (g.trick.length === 0) {
          // Leading with a live nil partner: high is the helpful choice.
          const card = chooseAs(g, PARTNER, partnerAs);
          s.leads++;
          s.leadRankTotal += rankOf(card);
          if (rankOf(card) >= 9) s.highLeads++;
          g = playCard(g, card);
          continue;
        }
        // Is the nil bidder currently winning, and can the partner take it off them?
        const winner = g.trick[winningIndex(g.trick)];
        if (winner.seat === NIL) {
          const canRescue = legal.some((c) => beatsTrick(c, g.trick));
          if (canRescue) {
            s.rescueChances++;
            const card = chooseAs(g, PARTNER, partnerAs);
            if (beatsTrick(card, g.trick)) s.rescuesTaken++;
            g = playCard(g, card);
            continue;
          }
        }
      }

      g = playCard(g, chooseAs(g, seat, seat === PARTNER ? partnerAs : difficulty));
      continue;
    }

    if (g.phase === 'trickComplete') {
      if (g.trickWinnerSeat === PARTNER && g.trick.some((t) => t.seat === NIL)) s.dumpChances++;
      g = resolveTrick(g);
      continue;
    }

    if (g.phase === 'handComplete') {
      s.hands++;
      if (g.lastHand!.tricksWon[NIL] === 0) s.nilMade++;
      g = dealNextHand(g);
      continue;
    }
    break;
  }
  return s;
}

function legalFor(g: GameState, seat: Seat): Card[] {
  return legalMoves(g.hands[seat], g.trick, g.spadesBroken);
}

function report(label: string, s: Stats) {
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : 'n/a');
  console.log(`\n${label}`);
  console.log(`  nil made:                       ${s.nilMade}/${s.hands}  (${pct(s.nilMade, s.hands)})`);
  console.log(
    `  partner's average lead rank:    ${(s.leadRankTotal / Math.max(1, s.leads)).toFixed(1)}  (0 = deuce, 12 = ace) over ${s.leads} leads`
  );
  console.log(`  leads that were jack or better: ${pct(s.highLeads, s.leads)}`);
  console.log(
    `  rescued the nil when it could:  ${s.rescuesTaken}/${s.rescueChances}  (${pct(s.rescuesTaken, s.rescueChances)})`
  );
}

console.log(`${HANDS} nil hands per setting, South bids nil`);
console.log('opponents held at "intermediate" throughout, only the partner varies:');
for (const d of ['beginner', 'intermediate', 'advanced'] as Difficulty[]) {
  report(`partner plays as: ${d}`, run('intermediate', 777, d));
}
console.log(
  '\nA partner that helps should lead high (rank well above 6), and should take the trick'
);
console.log('off the nil bidder essentially every time it is able to.');
