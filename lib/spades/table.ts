import { Seat } from './cards';
import { Difficulty } from './game';

/**
 * The pool a player picks their key from. Twenty-four options over six columns
 * is what lets every key be a comfortable thumb target on a phone; more icons
 * would mean smaller ones, and this keypad gets tapped forty-odd times a hand.
 * A blind guess lands about four percent of the time, which is enough to stop
 * an idle poke without turning the handoff into a password prompt.
 *
 * Chosen to be easy to tell apart at a glance and on a small screen - no
 * near-duplicate faces, no pairs that differ only by colour.
 */
export const KEY_ICONS = [
  '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🦉', '🐢',
  '🐙', '🦀', '🐝', '🦋', '🐬', '🦈',
  '🌵', '🌻', '🍉', '🍕', '🚀', '🎲',
];

export interface SeatSetup {
  name: string;
  /** The secret key. Null for a computer seat, which never needs unlocking. */
  icon: string | null;
  isAI: boolean;
}

export interface TableRoster {
  /** Indexed by seat: 0 South, 1 West, 2 North, 3 East. */
  seats: SeatSetup[];
  targetScore: number;
  allowNil: boolean;
  difficulty: Difficulty;
}

/** Seat order around the phone, and who partners whom. */
export const SEATS: Seat[] = [0, 1, 2, 3];
export const TEAM_SEATS: [Seat, Seat][] = [
  [0, 2],
  [1, 3],
];
export const SEAT_POSITION = ['South', 'West', 'North', 'East'];

export function defaultRoster(): TableRoster {
  return {
    seats: [
      { name: 'Player 1', icon: null, isAI: false },
      { name: 'Player 2', icon: null, isAI: false },
      { name: 'Player 3', icon: null, isAI: false },
      { name: 'Player 4', icon: null, isAI: false },
    ],
    targetScore: 350,
    allowNil: true,
    difficulty: 'intermediate',
  };
}

export function teamName(roster: TableRoster, team: 0 | 1): string {
  const [a, b] = TEAM_SEATS[team];
  return `${roster.seats[a].name} & ${roster.seats[b].name}`;
}

export function seatLabels(roster: TableRoster): string[] {
  return roster.seats.map((s) => s.name);
}

/** Every human seat still missing a key. Setup is not finished until this is empty. */
export function seatsNeedingKeys(roster: TableRoster): Seat[] {
  return SEATS.filter((s) => !roster.seats[s].isAI && !roster.seats[s].icon);
}

export function isReady(roster: TableRoster): boolean {
  const named = roster.seats.every((s) => s.name.trim().length > 0);
  return named && seatsNeedingKeys(roster).length === 0;
}

// ------------------------------------------------------------- persistence --

const STORAGE_KEY = 'spades-table-roster-v1';

/**
 * Kept on the device so a family does not re-enter four names and four keys
 * every evening. Wrapped because storage throws in private windows, and a
 * missing roster just means the setup screen runs again.
 */
export function loadRoster(): TableRoster | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TableRoster;
    if (!Array.isArray(parsed.seats) || parsed.seats.length !== 4) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRoster(roster: TableRoster): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  } catch {
    // Storage unavailable: the table still plays, it just will not be remembered.
  }
}

export function clearRoster(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
