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

export interface HandOutcome {
  teamScore: [number, number];
  teamTricks: [number, number];
  teamBags: [number, number];
  made: [boolean, boolean];
}

export function outcomeOf(st: PlayState): HandOutcome {
  const a = scoreTeamHand(TEAM_SEATS[0], st.bids, st.tricksWon, st.bagsBefore[0]);
  const b = scoreTeamHand(TEAM_SEATS[1], st.bids, st.tricksWon, st.bagsBefore[1]);
  return {
    teamScore: [a.score, b.score],
    teamTricks: [st.tricksWon[0] + st.tricksWon[2], st.tricksWon[1] + st.tricksWon[3]],
    teamBags: [a.bagsEarned, b.bagsEarned],
    made: [a.madeContract && a.nilResults.every((n) => n.made), b.madeContract && b.nilResults.every((n) => n.made)],
  };
}

/**
 * Value of a finished hand from `team`'s point of view, expressed in "points"
 * (a tenth of a spades score point, so one trick is roughly 1.0).
 * Opponent score is weighted slightly below our own so the engine prefers
 * making its own contract over setting theirs, all else equal.
 */
export function terminalUtility(st: PlayState, team: 0 | 1): number {
  const o = outcomeOf(st);
  const mine = o.teamScore[team];
  const theirs = o.teamScore[team === 0 ? 1 : 0];
  return (mine - 0.75 * theirs) / 10;
}
