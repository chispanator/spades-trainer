'use client';

import { Seat, SEAT_NAME, partnerOf } from '@/lib/spades/cards';
import { GameState, HUMAN } from '@/lib/spades/game';
import { CardBack, PlayingCard } from './PlayingCard';

function bidLabel(bid: number | null): string {
  if (bid === null) return '—';
  return bid === 0 ? 'nil' : String(bid);
}

interface ViewProps {
  /**
   * Whose side of the table we are looking from. Null means nobody is looking:
   * every hand stays face down, which is what the pass-and-play table shows
   * between turns.
   */
  viewSeat?: Seat | null;
  /** Names to print on the seat plates; defaults to the trainer's fixed labels. */
  seatLabels?: string[];
}

function SeatPlate({
  seat,
  game,
  thinking,
  viewSeat,
  seatLabels,
}: { seat: Seat; game: GameState; thinking: boolean } & ViewProps) {
  const isTurn = game.turn === seat && game.phase !== 'trickComplete' && game.phase !== 'handComplete';
  const sameTeam = viewSeat !== null && viewSeat !== undefined && (seat === viewSeat || seat === partnerOf(viewSeat));
  const bid = game.bids[seat];
  const won = game.tricksWon[seat];
  const label = seatLabels ? seatLabels[seat] : SEAT_NAME[seat];

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-colors ${
        isTurn ? 'bg-white/12 ring-1 ring-[color:var(--accent)]/60' : 'bg-white/5 ring-1 ring-white/5'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`max-w-[7rem] truncate text-sm font-semibold ${
            viewSeat === null || viewSeat === undefined
              ? 'text-[color:var(--foreground)]'
              : sameTeam
                ? 'text-emerald-200'
                : 'text-rose-200'
          }`}
        >
          {label}
        </span>
        {thinking && isTurn && (
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
            thinking
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
        <span>
          bid <span className="font-semibold text-[color:var(--foreground)]">{bidLabel(bid)}</span>
        </span>
        <span className="text-white/20">|</span>
        <span>
          won <span className="font-semibold text-[color:var(--foreground)]">{won}</span>
        </span>
      </div>
      {seat !== viewSeat && (
        <div className="flex -space-x-3.5" aria-label={`${game.hands[seat].length} cards remaining`}>
          {game.hands[seat].slice(0, 8).map((_, i) => (
            <CardBack key={i} size="sm" className="!h-6 !w-4 rounded-sm" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Where each seat's card sits inside the middle of the table, rotated so the
 * seat being looked from is always at the bottom.
 */
const BASE_POS = [
  'bottom-1 left-1/2 -translate-x-1/2',
  'left-1 top-1/2 -translate-y-1/2',
  'top-1 left-1/2 -translate-x-1/2',
  'right-1 top-1/2 -translate-y-1/2',
];

export function GameTable({
  game,
  thinking,
  viewSeat = HUMAN,
  seatLabels,
}: { game: GameState; thinking: boolean } & ViewProps) {
  const winner = game.trickWinnerSeat;
  const anchor = viewSeat ?? 0;
  /** Seat at each screen position: bottom, left, top, right. */
  const at = (offset: number) => (((anchor + offset) % 4) + 4) % 4 as Seat;
  const posOf = (seat: Seat) => BASE_POS[(((seat - anchor) % 4) + 4) % 4];
  const nameOf = (seat: Seat) => (seatLabels ? seatLabels[seat] : SEAT_NAME[seat]);

  const plate = (seat: Seat) => (
    <SeatPlate
      seat={seat}
      game={game}
      thinking={thinking}
      viewSeat={viewSeat}
      seatLabels={seatLabels}
    />
  );

  return (
    <div className="rounded-3xl bg-[color:var(--felt)] p-3 shadow-[inset_0_0_60px_rgba(0,0,0,0.45)] ring-1 ring-black/40 sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] grid-rows-[auto_1fr_auto] items-center justify-items-center gap-2">
        <div />
        {plate(at(2))}
        <div />

        {plate(at(1))}

        <div className="relative my-2 h-44 w-full min-w-[13rem] rounded-2xl bg-black/15 ring-1 ring-white/5 sm:h-52">
          {game.trick.map((tc) => (
            <div key={tc.card} className={`absolute ${posOf(tc.seat)} card-land`}>
              <PlayingCard
                card={tc.card}
                size="md"
                highlight={game.phase === 'trickComplete' && winner === tc.seat ? 'winner' : null}
              />
            </div>
          ))}
          {game.trick.length === 0 && game.phase !== 'bidding' && (
            <p className="absolute inset-0 grid place-items-center text-xs text-white/30">
              {game.turn === viewSeat ? 'your lead' : `${nameOf(game.turn)} to lead`}
            </p>
          )}
          {game.phase === 'bidding' && (
            <p className="absolute inset-0 grid place-items-center text-xs text-white/30">bidding</p>
          )}
          {game.phase === 'trickComplete' && winner !== null && (
            <p className="absolute bottom-1 right-2 text-[11px] font-medium text-[color:var(--accent)]">
              {winner === viewSeat ? 'you take it' : `${nameOf(winner)} takes it`}
            </p>
          )}
        </div>

        {plate(at(3))}

        <div />
        {plate(at(0))}
        <div />
      </div>
    </div>
  );
}
