'use client';

import Link from 'next/link';
import { useState } from 'react';

const MODES = [
  { key: 'trainer', href: '/', label: 'Solo trainer', blurb: 'Play alone and be graded' },
  { key: 'table', href: '/table', label: 'Pass the phone', blurb: 'Play together on one phone' },
] as const;

type ModeKey = (typeof MODES)[number]['key'];

/**
 * Moves between the two apps. Both were previously reachable only through a
 * small line of grey text, which is a poor way to advertise half of what is
 * here.
 *
 * `guard` is the sentence to show before leaving a game in progress: nothing is
 * stored on a server, so walking away really does end the hand.
 */
export function ModeSwitch({
  current,
  guard = null,
  size = 'full',
}: {
  current: ModeKey;
  guard?: string | null;
  size?: 'full' | 'compact';
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const other = MODES.find((m) => m.key !== current)!;

  if (confirming) {
    return (
      <div className="panel-rise rounded-2xl bg-[#132520] p-3 ring-1 ring-amber-400/30">
        <p className="text-sm text-amber-200">{guard}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20"
          >
            Stay here
          </button>
          <Link
            href={confirming}
            className="flex-1 rounded-xl bg-[color:var(--accent)] px-3 py-2 text-center text-sm font-semibold text-black transition hover:brightness-110"
          >
            Leave
          </Link>
        </div>
      </div>
    );
  }

  if (size === 'compact') {
    const className =
      'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20';
    return guard ? (
      <button type="button" onClick={() => setConfirming(other.href)} className={className}>
        <span aria-hidden>⇄</span> {other.label}
      </button>
    ) : (
      <Link href={other.href} className={className}>
        <span aria-hidden>⇄</span> {other.label}
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-2 ring-1 ring-white/10">
      {MODES.map((m) => {
        const isCurrent = m.key === current;
        const inner = (
          <>
            <span className="text-sm font-semibold">{m.label}</span>
            <span className="text-[11px] text-[color:var(--muted)]">{m.blurb}</span>
          </>
        );
        const className = `flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 text-center transition ${
          isCurrent
            ? 'bg-[color:var(--accent)] text-black'
            : 'bg-white/5 hover:bg-white/15'
        }`;
        if (isCurrent) {
          return (
            <span key={m.key} className={className} aria-current="page">
              <span className="text-sm font-semibold">{m.label}</span>
              <span className="text-[11px] text-black/60">{m.blurb}</span>
            </span>
          );
        }
        return guard ? (
          <button
            key={m.key}
            type="button"
            onClick={() => setConfirming(m.href)}
            className={className}
          >
            {inner}
          </button>
        ) : (
          <Link key={m.key} href={m.href} className={className}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
