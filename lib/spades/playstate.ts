import { Card, Seat, nextSeat, suitOf } from './cards';
import { TrickCard, trickWinner, scoreTeamHand, TEAM_SEATS } from './rules';

/** Minimal, cheap-to-clone state used by the simulation engine. */
export interface PlayState {
  hands: Card[][];
  bids: number[]; // 0 = nil
  turn: Seat;
  trick: TrickCard[];
  spadesBroken: boolean;
  tricksWon: number[];
  bagsBefore: [number, number];
}

export function clonePlayState(st: PlayState): PlayState {
  return {
    hands: [st.hands[0].slice(), st.hands[1].slice(), st.hands[2].slice(), st.hands[3].slice()],
    bids: st.bids,
    turn: st.turn,
    trick: st.trick.slice(),
    spadesBroken: st.spadesBroken,
    tricksWon: st.tricksWon.slice(),
    bagsBefore: st.bagsBefore,
  };
}

/** Plays a card for `st.turn`, resolving the trick when the fourth card lands. */
export function applyCard(st: PlayState, card: Card): void {
  const seat = st.turn;
  const hand = st.hands[seat];
  const idx = hand.indexOf(card);
  if (idx >= 0) hand.splice(idx, 1);
  if (suitOf(card) === 3) st.spadesBroken = true;
  st.trick.push({ seat, card });
  if (st.trick.length === 4) {
    const w = trickWinner(st.trick);
    st.tricksWon[w]++;
    st.trick = [];
    st.turn = w;
  } else {
    st.turn = nextSeat(seat);
  }
}

export function isTerminal(st: PlayState): boolean {
  return st.hands[0].length === 0 && st.trick.length === 0;
}

/**
 * What one bag really costs, beyond the +1 it scores on the night.
 *
 * A bag is worth +1 immediately, but every tenth bag costs 100. Over a game
 * that works out at -10 per bag on top of the +1, so an overtrick is worth
 * about -9, not +1. Scoring bags at face value is exactly what makes an engine
 * hoover up tricks it never needed - it sees free points where a good player
 * sees a slow leak. The hand score itself stays honest; this correction is
 * applied only when *judging* a play.
 *
 * The adjustment cancels against the real -100 when the penalty does fire, so
 * every bag is valued the same whether the counter is at 0 or at 9.
 */
export const BAG_TRUE_COST = 10;

/**
 * How much an opponent's point is worth against one of ours. Spades is a race,
 * so a point they do not score is worth as much as a point we do: setting them
 * and making our own contract are weighed on the same scale.
 */
export const OPPONENT_WEIGHT = 1;

export interface HandOutcome {
  /** The real score, exactly as it goes on the scoreboard. */
  teamScore: [number, number];
  /** The score the engine judges by, with bags at their true long-run cost. */
  teamValue: [number, number];
  teamTricks: [number, number];
  teamBags: [number, number];
  made: [boolean, boolean];
}

export function outcomeOf(st: PlayState): HandOutcome {
  const a = scoreTeamHand(TEAM_SEATS[0], st.bids, st.tricksWon, st.bagsBefore[0]);
  const b = scoreTeamHand(TEAM_SEATS[1], st.bids, st.tricksWon, st.bagsBefore[1]);
  const value = (s: typeof a) => s.score - BAG_TRUE_COST * s.bagsEarned + 100 * s.bagPenalties;
  return {
    teamScore: [a.score, b.score],
    teamValue: [value(a), value(b)],
    teamTricks: [st.tricksWon[0] + st.tricksWon[2], st.tricksWon[1] + st.tricksWon[3]],
    teamBags: [a.bagsEarned, b.bagsEarned],
    made: [a.madeContract && a.nilResults.every((n) => n.made), b.madeContract && b.nilResults.every((n) => n.made)],
  };
}

/**
 * Value of a finished hand from `team`'s point of view, in "points" - a tenth
 * of a spades score point, so a trick that decides nothing else is about 1.0.
 */
export function terminalUtility(st: PlayState, team: 0 | 1): number {
  const o = outcomeOf(st);
  const mine = o.teamValue[team];
  const theirs = o.teamValue[team === 0 ? 1 : 0];
  return (mine - OPPONENT_WEIGHT * theirs) / 10;
}
