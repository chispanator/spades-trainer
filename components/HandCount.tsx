'use client';

import { useState } from 'react';
import { Card, SUIT_IS_RED, SUIT_LABEL, SUIT_NAME, sortForDisplay, suitOf } from '@/lib/spades/cards';
import { HandCountReview } from '@/lib/spades/coach';
import { TrickEstimate } from '@/lib/spades/mc';
import { GradeBadge } from './Coach';
import { CardChip } from './PlayingCard';

/** Suits top to bottom, trumps first, matching how the hand is displayed. */
const ROW_ORDER = [3, 2, 1, 0];

function SuitGlyph({ suit }: { suit: number }) {
  return (
    <span className={SUIT_IS_RED[suit] ? 'text-rose-400' : 'text-[color:var(--foreground)]'}>
      {SUIT_LABEL[suit]}
    </span>
  );
}

export function HandCountWorksheet({
  hand,
  onSubmit,
  onSkip,
}: {
  hand: Card[];
  onSubmit: (counts: number[]) => void;
  onSkip: () => void;
}) {
  const lengths = [0, 0, 0, 0];
  for (const c of hand) lengths[suitOf(c)]++;
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0]);
  const total = counts.reduce((a, b) => a + b, 0);

  const set = (suit: number, v: number) => {
    const next = counts.slice();
    next[suit] = Math.max(0, Math.min(lengths[suit], v));
    setCounts(next);
  };

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold">Count your hand</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        How many tricks does each suit give you? Commit to a number before the engine shows its
        own — that comparison is the whole point.
      </p>

      <div className="mt-3 space-y-2">
        {ROW_ORDER.filter((s) => lengths[s] > 0).map((s) => {
          const cards = sortForDisplay(hand.filter((c) => suitOf(c) === s));
          return (
            <div key={s} className="rounded-xl bg-white/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <SuitGlyph suit={s} />
                  {SUIT_NAME[s]}
                  <span className="text-xs font-normal text-[color:var(--muted)]">
                    {lengths[s]} card{lengths[s] === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer ${SUIT_NAME[s]} trick`}
                    onClick={() => set(s, counts[s] - 1)}
                    className="h-7 w-7 rounded-lg bg-white/10 text-sm font-semibold transition hover:bg-white/20"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-semibold tabular-nums">{counts[s]}</span>
                  <button
                    type="button"
                    aria-label={`One more ${SUIT_NAME[s]} trick`}
                    onClick={() => set(s, counts[s] + 1)}
                    className="h-7 w-7 rounded-lg bg-white/10 text-sm font-semibold transition hover:bg-white/20"
                  >
                    +
                  </button>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cards.map((c) => (
                  <CardChip key={c} card={c} className="text-[10px]" />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {lengths.some((l) => l === 0) && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          You are void in{' '}
          {[0, 1, 2, 3]
            .filter((s) => lengths[s] === 0)
            .map((s) => SUIT_NAME[s].toLowerCase())
            .join(' and ')}
          . Remember that shortness pays in the spade row, not here.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
        <span className="text-sm font-medium">Your count</span>
        <span className="text-lg font-semibold tabular-nums">{total}</span>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(counts)}
        className="mt-3 w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
      >
        Lock it in and compare
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="mt-2 w-full text-xs text-[color:var(--muted)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
      >
        Skip counting and just bid
      </button>
    </div>
  );
}

export function HandCountResult({
  review,
  estimate,
  onDone,
}: {
  review: HandCountReview;
  estimate: TrickEstimate;
  onDone: () => void;
}) {
  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={review.grade} />
        <span className="text-xs text-[color:var(--muted)]">
          over {estimate.samples} simulated deals
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{review.headline}</p>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-[color:var(--muted)]">
            <th className="text-left font-normal">Suit</th>
            <th className="text-right font-normal">Held</th>
            <th className="text-right font-normal">You</th>
            <th className="text-right font-normal">Engine</th>
          </tr>
        </thead>
        <tbody>
          {ROW_ORDER.filter((s) => estimate.lengths[s] > 0 || review.yours[s] > 0).map((s) => {
            const gap = review.yours[s] - review.engine[s];
            const tone =
              Math.abs(gap) < 0.8
                ? 'text-[color:var(--foreground)]'
                : gap > 0
                  ? 'text-amber-300'
                  : 'text-emerald-300';
            return (
              <tr key={s}>
                <td className="py-1">
                  <span className="flex items-center gap-1.5">
                    <SuitGlyph suit={s} />
                    {SUIT_NAME[s]}
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums text-[color:var(--muted)]">
                  {estimate.lengths[s]}
                </td>
                <td className="py-1 text-right tabular-nums">{review.yours[s]}</td>
                <td className={`py-1 text-right font-semibold tabular-nums ${tone}`}>
                  {review.engine[s].toFixed(1)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-white/10">
            <td className="py-1 font-medium">Total</td>
            <td className="py-1 text-right tabular-nums text-[color:var(--muted)]">13</td>
            <td className="py-1 text-right font-semibold tabular-nums">{review.totalYours}</td>
            <td className="py-1 text-right font-semibold tabular-nums">
              {review.totalEngine.toFixed(1)}
            </td>
          </tr>
        </tbody>
      </table>

      {estimate.ruffs >= 0.15 && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {estimate.ruffs.toFixed(1)} of the spade tricks come from ruffing a suit you run out of,
          not from the trumps standing up on their own.
        </p>
      )}

      <ul className="mt-3 space-y-1.5 text-sm text-[color:var(--foreground)]/85">
        {review.notes.map((n, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--accent)]" />
            <span>{n}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onDone}
        autoFocus
        className="mt-4 w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
      >
        Now place your bid
      </button>
    </div>
  );
}
