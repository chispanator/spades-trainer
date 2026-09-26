'use client';

import { useState } from 'react';
import { cardName } from '@/lib/spades/cards';
import { BidReview, GRADE_LABEL, Grade, PlayReview } from '@/lib/spades/coach';
import { SessionStats } from '@/lib/spades/game';
import { CardChip, PlayingCard } from './PlayingCard';

const GRADE_STYLE: Record<Grade, { chip: string; text: string; bar: string }> = {
  optimal: { chip: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30', text: 'text-emerald-300', bar: 'bg-emerald-400' },
  good: { chip: 'bg-teal-400/15 text-teal-300 ring-teal-400/30', text: 'text-teal-300', bar: 'bg-teal-400' },
  inaccuracy: { chip: 'bg-amber-400/15 text-amber-300 ring-amber-400/30', text: 'text-amber-300', bar: 'bg-amber-400' },
  mistake: { chip: 'bg-orange-400/15 text-orange-300 ring-orange-400/30', text: 'text-orange-300', bar: 'bg-orange-400' },
  blunder: { chip: 'bg-rose-400/15 text-rose-300 ring-rose-400/30', text: 'text-rose-300', bar: 'bg-rose-400' },
};

export function GradeBadge({ grade, className = '' }: { grade: Grade; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ${GRADE_STYLE[grade].chip} ${className}`}
    >
      {GRADE_LABEL[grade]}
    </span>
  );
}

function ProbBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[11px] text-[color:var(--muted)]">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-sky-400" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-[color:var(--muted)]">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function Alternatives({ review }: { review: PlayReview }) {
  const top = review.ranked[0].ev;
  const tied = new Set(review.tied);
  return (
    <ul className="mt-2 space-y-1.5">
      {review.ranked.slice(0, 7).map((c) => {
        const loss = top - c.ev;
        const isPlayed = c.card === review.played;
        const isBest = c.card === review.best;
        // Cards inside the margin of error are shown as level rather than
        // separated by two decimal places the simulation cannot stand behind.
        const gap = isBest ? 'best' : tied.has(c.card) ? 'level' : `-${loss.toFixed(2)}`;
        return (
          <li
            key={c.card}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
              isPlayed ? 'bg-sky-400/10 ring-1 ring-sky-400/25' : ''
            }`}
          >
            <CardChip card={c.card} className="text-[11px]" />
            <span className="w-16 shrink-0 tabular-nums text-[color:var(--muted)]">{gap}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
              <span
                className={`block h-full rounded-full ${isBest ? 'bg-emerald-400' : isPlayed ? 'bg-sky-400' : 'bg-white/25'}`}
                style={{ width: `${Math.max(3, Math.round(c.makeProb * 100))}%` }}
              />
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-[color:var(--muted)]">
              {Math.round(c.makeProb * 100)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function FeedbackCard({
  review,
  onContinue,
  autoAdvance,
}: {
  review: PlayReview;
  onContinue: () => void;
  autoAdvance?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const style = GRADE_STYLE[review.grade];

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={review.grade} />
        <span className="text-xs text-[color:var(--muted)]">trick {review.trickNumber}</span>
        {review.withinNoise && (
          <span className="text-xs text-[color:var(--muted)]">· too close to call</span>
        )}
      </div>

      <p className={`mt-2 text-sm font-medium ${style.text}`}>{review.headline}</p>

      {review.hadChoice && (
        <div className="mt-3 flex items-center gap-4">
          <figure className="flex flex-col items-center gap-1">
            <PlayingCard card={review.played} size="sm" highlight="played" />
            <figcaption className="text-[10px] uppercase tracking-wide text-sky-300">you played</figcaption>
          </figure>
          {review.best !== review.played && (
            <>
              <span className="text-[color:var(--muted)]">→</span>
              <figure className="flex flex-col items-center gap-1">
                <PlayingCard card={review.best} size="sm" highlight="best" />
                <figcaption className="text-[10px] uppercase tracking-wide text-emerald-300">engine pick</figcaption>
              </figure>
            </>
          )}
          <div className="ml-auto text-right">
            <p className="text-xs text-[color:var(--muted)]">value given up</p>
            <p className={`text-lg font-semibold tabular-nums ${style.text}`}>
              {review.loss < 0.005 ? '0.00' : `-${review.loss.toFixed(2)}`}
            </p>
          </div>
        </div>
      )}

      {review.notes.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm text-[color:var(--foreground)]/85">
          {review.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--accent)]" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {review.hadChoice && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-[color:var(--muted)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
          >
            {showAll ? 'hide' : `compare all ${review.ranked.length} legal cards`}
          </button>
          {showAll && (
            <>
              <p className="mt-2 text-[11px] text-[color:var(--muted)]">
                Bars show how often your side makes its contract after each card. Cards still
                in contention were measured over {review.ranked[0].samples} deals; the rest were
                eliminated in a cheaper first round. &ldquo;Level&rdquo; means the gap to the top
                row is smaller than the simulation&rsquo;s own margin of error.
              </p>
              <Alternatives review={review} />
            </>
          )}
        </div>
      )}

      {!autoAdvance && (
        <button
          type="button"
          onClick={onContinue}
          autoFocus
          className="mt-4 w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
        >
          Continue
        </button>
      )}
    </div>
  );
}

export function BidFeedback({
  review,
  onContinue,
}: {
  review: BidReview;
  /** Omitted when the review is shown as part of a summary rather than a prompt. */
  onContinue?: () => void;
}) {
  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={review.grade} />
        <span className="text-xs text-[color:var(--muted)]">
          you bid {review.bid === 0 ? 'nil' : review.bid}
          {review.suggested !== review.bid &&
            ` · engine says ${review.suggestNil ? 'nil' : review.suggested}`}
        </span>
      </div>
      <p className={`mt-2 text-sm font-medium ${GRADE_STYLE[review.grade].text}`}>{review.headline}</p>
      <ul className="mt-3 space-y-1.5 text-sm text-[color:var(--foreground)]/85">
        {review.notes.map((n, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--accent)]" />
            <span>{n}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-1">
        {[0, 1, 2, 3, 4, 5, 6]
          .filter((n) => review.estimate.distribution[n] >= 0.04)
          .map((n) => (
            <ProbBar
              key={n}
              value={review.estimate.distribution[n]}
              label={`exactly ${n} trick${n === 1 ? '' : 's'}`}
            />
          ))}
      </div>
      {onContinue && (
        <button
          type="button"
          onClick={onContinue}
          autoFocus
          className="mt-4 w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
        >
          Play the hand
        </button>
      )}
    </div>
  );
}

export function ReviewList({ reviews }: { reviews: PlayReview[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const interesting = reviews.filter((r) => r.hadChoice);
  if (!interesting.length) {
    return <p className="text-sm text-[color:var(--muted)]">No decisions with a real choice this hand.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {interesting.map((r, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/10"
          >
            <span className="w-14 shrink-0 text-xs text-[color:var(--muted)]">trick {r.trickNumber}</span>
            <CardChip card={r.played} className="text-[11px]" />
            {r.best !== r.played && (
              <>
                <span className="text-xs text-[color:var(--muted)]">vs</span>
                <CardChip card={r.best} className="text-[11px]" />
              </>
            )}
            <GradeBadge grade={r.grade} className="ml-auto" />
          </button>
          {open === i && (
            <div className="mt-1.5">
              <FeedbackCard review={r} onContinue={() => setOpen(null)} autoAdvance />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AccuracyBar({ stats }: { stats: SessionStats }) {
  const order: Grade[] = ['optimal', 'good', 'inaccuracy', 'mistake', 'blunder'];
  const total = Math.max(1, stats.totalDecisions);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
        {order.map((g) =>
          stats.counts[g] ? (
            <span
              key={g}
              className={GRADE_STYLE[g].bar}
              style={{ width: `${(stats.counts[g] / total) * 100}%` }}
              title={`${GRADE_LABEL[g]}: ${stats.counts[g]}`}
            />
          ) : null
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted)]">
        {order.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${GRADE_STYLE[g].bar}`} />
            {GRADE_LABEL[g]} {stats.counts[g]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HintCard({ card, onDismiss }: { card: number; onDismiss: () => void }) {
  return (
    <div className="panel-rise flex items-center gap-3 rounded-2xl bg-emerald-400/10 p-3 ring-1 ring-emerald-400/25">
      <PlayingCard card={card} size="sm" highlight="best" />
      <div className="text-sm">
        <p className="font-medium text-emerald-300">Play {cardName(card)}</p>
        <p className="text-xs text-[color:var(--muted)]">You can still choose anything you like.</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto rounded-lg px-2 py-1 text-xs text-[color:var(--muted)] hover:bg-white/10"
      >
        dismiss
      </button>
    </div>
  );
}
