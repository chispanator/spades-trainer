'use client';

import { Seat, SEAT_NAME, partnerOf } from '@/lib/spades/cards';
import { GameState, HUMAN } from '@/lib/spades/game';
import { CardBack, PlayingCard } from './PlayingCard';

function bidLabel(bid: number | null): string {
  if (bid === null) return '—';
  return bid === 0 ? 'nil' : String(bid);
}

function SeatPlate({
  seat,
  game,
  thinking,
}: {
  seat: Seat;
  game: GameState;
  thinking: boolean;
}) {
  const isTurn = game.turn === seat && game.phase !== 'trickComplete' && game.phase !== 'handComplete';
  const onMyTeam = seat === HUMAN || seat === partnerOf(HUMAN);
  const bid = game.bids[seat];
  const won = game.tricksWon[seat];

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-colors ${
        isTurn ? 'bg-white/12 ring-1 ring-[color:var(--accent)]/60' : 'bg-white/5 ring-1 ring-white/5'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-semibold ${onMyTeam ? 'text-emerald-200' : 'text-rose-200'}`}>
          {SEAT_NAME[seat]}
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
      {seat !== HUMAN && (
        <div className="flex -space-x-3.5" aria-label={`${game.hands[seat].length} cards remaining`}>
          {game.hands[seat].slice(0, 8).map((_, i) => (
            <CardBack key={i} size="sm" className="!h-6 !w-4 rounded-sm" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Where each seat's card sits inside the middle of the table. */
const TRICK_POS: Record<Seat, string> = {
  0: 'bottom-1 left-1/2 -translate-x-1/2',
  1: 'left-1 top-1/2 -translate-y-1/2',
  2: 'top-1 left-1/2 -translate-x-1/2',
  3: 'right-1 top-1/2 -translate-y-1/2',
};

export function GameTable({ game, thinking }: { game: GameState; thinking: boolean }) {
  const winner = game.trickWinnerSeat;

  return (
    <div className="rounded-3xl bg-[color:var(--felt)] p-3 shadow-[inset_0_0_60px_rgba(0,0,0,0.45)] ring-1 ring-black/40 sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] grid-rows-[auto_1fr_auto] items-center justify-items-center gap-2">
        <div />
        <SeatPlate seat={2} game={game} thinking={thinking} />
        <div />

        <SeatPlate seat={1} game={game} thinking={thinking} />

        <div className="relative my-2 h-44 w-full min-w-[13rem] rounded-2xl bg-black/15 ring-1 ring-white/5 sm:h-52">
          {game.trick.map((tc) => (
            <div key={tc.card} className={`absolute ${TRICK_POS[tc.seat]} card-land`}>
              <PlayingCard
                card={tc.card}
                size="md"
                highlight={game.phase === 'trickComplete' && winner === tc.seat ? 'winner' : null}
              />
            </div>
          ))}
          {game.trick.length === 0 && game.phase !== 'bidding' && (
            <p className="absolute inset-0 grid place-items-center text-xs text-white/30">
              {game.turn === HUMAN ? 'your lead' : `${SEAT_NAME[game.turn]} to lead`}
            </p>
          )}
          {game.phase === 'bidding' && (
            <p className="absolute inset-0 grid place-items-center text-xs text-white/30">bidding</p>
          )}
          {game.phase === 'trickComplete' && winner !== null && (
            <p className="absolute bottom-1 right-2 text-[11px] font-medium text-[color:var(--accent)]">
              {winner === HUMAN ? 'you take it' : `${SEAT_NAME[winner]} takes it`}
            </p>
          )}
        </div>

        <SeatPlate seat={3} game={game} thinking={thinking} />

        <div />
        <SeatPlate seat={0} game={game} thinking={thinking} />
        <div />
      </div>
    </div>
  );
}
