'use client';

import { useState } from 'react';
import { SEAT_NAME, Seat, partnerOf } from '@/lib/spades/cards';
import { Difficulty, GameState, HUMAN, HandResult } from '@/lib/spades/game';
import { TrickEstimate } from '@/lib/spades/mc';

export function Scoreboard({ game }: { game: GameState }) {
  const rows: { label: string; team: 0 | 1 }[] = [
    { label: 'You & Partner', team: 0 },
    { label: 'West & East', team: 1 },
  ];
  return (
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Score</h2>
        <span className="text-xs text-[color:var(--muted)]">
          hand {game.handNumber} · to {game.options.targetScore}
        </span>
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.team}>
              <td className={`py-1 ${r.team === 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{r.label}</td>
              <td className="py-1 text-right font-semibold tabular-nums">{game.scores[r.team]}</td>
              <td className="w-16 py-1 text-right text-xs text-[color:var(--muted)] tabular-nums">
                {game.bags[r.team]} bag{game.bags[r.team] === 1 ? '' : 's'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {game.bags.some((b) => b >= 7) && (
        <p className="mt-2 text-xs text-amber-300">
          Careful — ten bags costs 100 points.
        </p>
      )}
    </div>
  );
}

export function BidPanel({
  onBid,
  allowNil,
  estimate,
  onPeek,
  peeked,
}: {
  onBid: (bid: number) => void;
  allowNil: boolean;
  estimate: TrickEstimate | null;
  onPeek: () => void;
  peeked: boolean;
}) {
  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold">How many tricks will you take?</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Thirteen tricks are shared out. Your side scores ten a trick for making its combined bid,
        and loses that much for falling short.
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {allowNil && (
          <button
            type="button"
            onClick={() => onBid(0)}
            className="col-span-7 rounded-lg bg-white/10 py-2 text-sm font-semibold transition hover:bg-white/20"
          >
            Nil <span className="text-xs font-normal text-[color:var(--muted)]">— take none, +100 or -100</span>
          </button>
        )}
        {Array.from({ length: 13 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onBid(n)}
            className="rounded-lg bg-white/10 py-2 text-sm font-semibold tabular-nums transition hover:bg-[color:var(--accent)] hover:text-black"
          >
            {n}
          </button>
        ))}
      </div>
      {!peeked ? (
        <button
          type="button"
          onClick={onPeek}
          className="mt-3 text-xs text-[color:var(--muted)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          I am not sure — show me what this hand is worth
        </button>
      ) : (
        estimate && (
          <p className="mt-3 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200 ring-1 ring-emerald-400/20">
            Simulated over {estimate.samples} deals, this hand averages{' '}
            <strong>{estimate.expected.toFixed(1)} tricks</strong>
            {estimate.nilProb >= 0.35 && <> and takes none {Math.round(estimate.nilProb * 100)}% of the time</>}.
          </p>
        )
      )}
    </div>
  );
}

export function HandSummary({
  result,
  onNext,
  isGameOver,
  scores,
  targetScore,
  children,
}: {
  result: HandResult;
  onNext: () => void;
  isGameOver: boolean;
  scores: [number, number];
  targetScore: number;
  children?: React.ReactNode;
}) {
  const teamLabel = ['You & Partner', 'West & East'];
  const winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-base font-semibold">
        {isGameOver
          ? winner === 0
            ? 'You win the game.'
            : 'West and East win the game.'
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
          {[0, 1].map((t) => {
            const seats: Seat[] = t === 0 ? [0, 2] : [1, 3];
            const bid = seats.reduce<number>((n, s) => n + result.bids[s], 0);
            const won = seats.reduce<number>((n, s) => n + result.tricksWon[s], 0);
            const nils = seats.filter((s) => result.bids[s] === 0);
            return (
              <tr key={t} className={t === 0 ? 'text-emerald-200' : 'text-rose-200'}>
                <td className="py-1">
                  {teamLabel[t]}
                  {nils.length > 0 && (
                    <span className="ml-1 text-xs text-[color:var(--muted)]">
                      ({nils.map((s) => `${SEAT_NAME[s]} nil`).join(', ')})
                    </span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">{bid}</td>
                <td className="py-1 text-right tabular-nums">{won}</td>
                <td className="py-1 text-right font-semibold tabular-nums">
                  {result.handScore[t] >= 0 ? '+' : ''}
                  {result.handScore[t]}
                </td>
                <td className="py-1 text-right font-semibold tabular-nums">{result.totals[t]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {children}

      <button
        type="button"
        onClick={onNext}
        className="mt-4 w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
      >
        {isGameOver ? `New game to ${targetScore}` : 'Deal the next hand'}
      </button>
    </div>
  );
}

export interface Settings {
  difficulty: Difficulty;
  coachMode: 'mistakes' | 'instant' | 'endOfHand';
  allowNil: boolean;
  targetScore: number;
}

export function SettingsPanel({
  settings,
  onChange,
  onNewGame,
  disabled,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onNewGame: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        Settings
        <span className="text-xs text-[color:var(--muted)]">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-white/10 px-4 py-3 text-sm">
          <Choice
            label="Feedback"
            hint="When the coach interrupts you."
            value={settings.coachMode}
            options={[
              { value: 'mistakes', label: 'Only on mistakes' },
              { value: 'instant', label: 'After every card' },
              { value: 'endOfHand', label: 'At the end of the hand' },
            ]}
            onChange={(v) => onChange({ ...settings, coachMode: v as Settings['coachMode'] })}
          />
          <Choice
            label="Opponents"
            hint="How much the other three seats think."
            value={settings.difficulty}
            options={[
              { value: 'beginner', label: 'Casual' },
              { value: 'intermediate', label: 'Solid' },
              { value: 'advanced', label: 'Tough' },
            ]}
            onChange={(v) => onChange({ ...settings, difficulty: v as Difficulty })}
          />
          <Choice
            label="Nil bids"
            hint="Allow bidding nil for 100 points."
            value={settings.allowNil ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => onChange({ ...settings, allowNil: v === 'on' })}
          />
          <Choice
            label="Game to"
            hint="Points needed to win."
            value={String(settings.targetScore)}
            options={[
              { value: '200', label: '200' },
              { value: '350', label: '350' },
              { value: '500', label: '500' },
            ]}
            onChange={(v) => onChange({ ...settings, targetScore: Number(v) })}
          />
          <button
            type="button"
            onClick={onNewGame}
            disabled={disabled}
            className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"
          >
            Start a new game
          </button>
          <p className="text-xs text-[color:var(--muted)]">
            Changes to opponents, nil and target apply from the next game.
          </p>
        </div>
      )}
    </div>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="text-xs text-[color:var(--muted)]">{hint}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              value === o.value
                ? 'bg-[color:var(--accent)] text-black'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StartScreen({
  settings,
  onChange,
  onStart,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-4 py-10">
      <div className="w-full">
        <h1 className="text-3xl font-semibold tracking-tight">Spades Trainer</h1>
        <p className="mt-2 text-sm text-[color:var(--foreground)]/80">
          Play a full game of spades against three simulated opponents. After every card you play,
          the same engine deals out thousands of hands the opposition could be holding and tells you
          what your choice was worth — and what would have been better.
        </p>
        <ul className="mt-4 space-y-1.5 text-sm text-[color:var(--muted)]">
          <li>· Bids are graded against a simulation of the hand you were dealt.</li>
          <li>· Every card gets a verdict, with the reasoning spelled out.</li>
          <li>· Ask for the best card at any point if you would rather be shown.</li>
        </ul>

        <div className="mt-6 space-y-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <Choice
            label="Feedback"
            hint="When the coach interrupts you."
            value={settings.coachMode}
            options={[
              { value: 'mistakes', label: 'Only on mistakes' },
              { value: 'instant', label: 'After every card' },
              { value: 'endOfHand', label: 'At the end of the hand' },
            ]}
            onChange={(v) => onChange({ ...settings, coachMode: v as Settings['coachMode'] })}
          />
          <Choice
            label="Opponents"
            hint="How much the other three seats think."
            value={settings.difficulty}
            options={[
              { value: 'beginner', label: 'Casual' },
              { value: 'intermediate', label: 'Solid' },
              { value: 'advanced', label: 'Tough' },
            ]}
            onChange={(v) => onChange({ ...settings, difficulty: v as Difficulty })}
          />
          <Choice
            label="Game to"
            hint="Points needed to win."
            value={String(settings.targetScore)}
            options={[
              { value: '200', label: '200' },
              { value: '350', label: '350' },
              { value: '500', label: '500' },
            ]}
            onChange={(v) => onChange({ ...settings, targetScore: Number(v) })}
          />
        </div>

        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110"
        >
          Deal the first hand
        </button>
      </div>
    </main>
  );
}

export function RulesPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        Rules and scoring
        <span className="text-xs text-[color:var(--muted)]">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/10 px-4 py-3 text-sm text-[color:var(--foreground)]/85">
          <p>
            You sit South. {SEAT_NAME[partnerOf(HUMAN)]} across the table is your partner; West and
            East are the opposition. Everyone is dealt thirteen cards and bids the number of tricks
            they expect to win.
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Follow the suit that was led if you can. If you cannot, play anything.</li>
            <li>Spades are trumps and beat every other suit.</li>
            <li>Nobody may lead a spade until a spade has been played on some earlier trick.</li>
            <li>Make your side&apos;s combined bid and score ten points a trick; miss it and lose the same.</li>
            <li>
              Every trick past the bid is a bag worth one point, but ten bags cost a hundred, so
              taking tricks you did not bid for is a slow leak.
            </li>
            <li>Nil is a bid to take no tricks at all: +100 if you manage it, -100 if you slip.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
