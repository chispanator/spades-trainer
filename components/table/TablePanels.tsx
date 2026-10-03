'use client';

import { Seat } from '@/lib/spades/cards';
import { GameState, HandResult } from '@/lib/spades/game';
import { TEAM_SEATS, TableRoster, teamName } from '@/lib/spades/table';
import { PlayingCard } from '@/components/PlayingCard';

export function TableScore({ game, roster }: { game: GameState; roster: TableRoster }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Score</h2>
        <span className="text-xs text-[color:var(--muted)]">
          hand {game.handNumber} · to {game.options.targetScore}
        </span>
      </div>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {([0, 1] as const).map((team) => (
            <tr key={team}>
              <td className={`py-1 ${team === 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                {teamName(roster, team)}
              </td>
              <td className="py-1 text-right font-semibold tabular-nums">{game.scores[team]}</td>
              <td className="w-14 py-1 text-right text-xs text-[color:var(--muted)] tabular-nums">
                {game.bags[team]} bag{game.bags[team] === 1 ? '' : 's'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bidding pad for whoever is holding the phone. No hints: this is a real game. */
export function TableBidPad({
  name,
  allowNil,
  onBid,
}: {
  name: string;
  allowNil: boolean;
  onBid: (bid: number) => void;
}) {
  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold">{name}, how many tricks will you take?</h2>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {allowNil && (
          <button
            type="button"
            onClick={() => onBid(0)}
            className="col-span-7 rounded-lg bg-white/10 py-2.5 text-sm font-semibold transition hover:bg-white/20"
          >
            Nil <span className="text-xs font-normal text-[color:var(--muted)]">— take none</span>
          </button>
        )}
        {Array.from({ length: 13 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onBid(n)}
            className="rounded-lg bg-white/10 py-2.5 text-sm font-semibold tabular-nums transition hover:bg-[color:var(--accent)] hover:text-black"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TableHandSummary({
  result,
  roster,
  isGameOver,
  scores,
  onNext,
}: {
  result: HandResult;
  roster: TableRoster;
  isGameOver: boolean;
  scores: [number, number];
  onNext: () => void;
}) {
  const winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-base font-semibold">
        {isGameOver && winner !== null
          ? `${teamName(roster, winner)} win!`
          : `Hand ${result.handNumber} complete`}
      </h2>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-[color:var(--muted)]">
            <th className="text-left font-normal">Side</th>
            <th className="text-right font-normal">Bid</th>
            <th className="text-right font-normal">Won</th>
            <th className="text-right font-normal">Hand</th>
            <th className="text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as const).map((team) => {
            const seats: Seat[] = TEAM_SEATS[team];
            const bid = seats.reduce<number>((n, s) => n + result.bids[s], 0);
            const won = seats.reduce<number>((n, s) => n + result.tricksWon[s], 0);
            const nils = seats.filter((s) => result.bids[s] === 0);
            return (
              <tr key={team} className={team === 0 ? 'text-emerald-200' : 'text-rose-200'}>
                <td className="py-1">
                  {teamName(roster, team)}
                  {nils.length > 0 && (
                    <span className="ml-1 text-xs text-[color:var(--muted)]">
                      ({nils.map((s) => `${roster.seats[s].name} nil`).join(', ')})
                    </span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">{bid}</td>
                <td className="py-1 text-right tabular-nums">{won}</td>
                <td className="py-1 text-right font-semibold tabular-nums">
                  {result.handScore[team] >= 0 ? '+' : ''}
                  {result.handScore[team]}
                </td>
                <td className="py-1 text-right font-semibold tabular-nums">
                  {result.totals[team]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[color:var(--muted)]">
        {([0, 1, 2, 3] as Seat[]).map((s) => (
          <span key={s}>
            {roster.seats[s].name}: bid {result.bids[s] === 0 ? 'nil' : result.bids[s]}, took{' '}
            {result.tricksWon[s]}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-4 w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110"
      >
        {isGameOver ? 'New game' : 'Deal the next hand'}
      </button>
    </div>
  );
}

/**
 * What the table may see while the phone is being passed: the trick in
 * progress, and where the bidding stands. Deliberately compact - the handoff
 * screen belongs to the keypad, and the full table reappears once the hand is
 * open. It also means less of the board is on show over somebody's shoulder.
 */
export function HandoffStrip({ game, roster }: { game: GameState; roster: TableRoster }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between text-xs text-[color:var(--muted)]">
        <span>
          hand {game.handNumber} · trick {game.completedTricks.length + 1}
        </span>
        <span className="tabular-nums">
          {teamName(roster, 0)} {game.scores[0]} · {teamName(roster, 1)} {game.scores[1]}
        </span>
      </div>

      <div className="mt-2 flex min-h-[3.25rem] items-center gap-2">
        {game.trick.length === 0 ? (
          <p className="text-xs text-[color:var(--muted)]">
            {game.phase === 'bidding' ? 'Bidding.' : 'Nothing played yet this trick.'}
          </p>
        ) : (
          game.trick.map((tc) => (
            <span key={tc.card} className="flex flex-col items-center gap-0.5">
              <PlayingCard card={tc.card} size="sm" />
              <span className="max-w-[3.5rem] truncate text-[10px] text-[color:var(--muted)]">
                {roster.seats[tc.seat].name}
              </span>
            </span>
          ))
        )}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--muted)]">
        {([0, 1, 2, 3] as Seat[]).map((s) => (
          <span key={s} className="truncate">
            {roster.seats[s].name}: {game.bids[s] === null ? '—' : game.bids[s] === 0 ? 'nil' : game.bids[s]} bid,{' '}
            {game.tricksWon[s]} won
          </span>
        ))}
      </div>
    </div>
  );
}
