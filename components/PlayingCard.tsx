'use client';

import { Card, RANK_LABEL, SUIT_IS_RED, SUIT_LABEL, cardNameLong, rankOf, suitOf } from '@/lib/spades/cards';

type Size = 'sm' | 'md' | 'lg' | 'fluid';

const SIZES: Record<Size, string> = {
  sm: 'w-11 h-16 text-[11px] rounded-md',
  md: 'w-14 h-20 text-xs rounded-lg',
  lg: 'w-16 h-24 sm:w-[4.5rem] sm:h-[6.5rem] text-sm rounded-lg',
  // Sized from the row it sits in - see .fluid-card in globals.css.
  fluid: 'fluid-card',
};

const PIP: Record<Size, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
  fluid: 'fluid-pip',
};

export function PlayingCard({
  card,
  size = 'md',
  dimmed = false,
  highlight,
  className = '',
  decorative = false,
}: {
  card: Card;
  size?: Size;
  dimmed?: boolean;
  highlight?: 'best' | 'played' | 'winner' | null;
  className?: string;
  /** Set when an ancestor already names the card, so it is not announced twice. */
  decorative?: boolean;
}) {
  const red = SUIT_IS_RED[suitOf(card)];
  const ring =
    highlight === 'best'
      ? 'ring-2 ring-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]'
      : highlight === 'played'
        ? 'ring-2 ring-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.18)]'
        : highlight === 'winner'
          ? 'ring-2 ring-[color:var(--accent)] shadow-[0_0_0_4px_rgba(240,193,75,0.2)]'
          : 'ring-1 ring-black/15';

  return (
    <div
      className={`relative flex flex-col justify-between bg-[#fdfcf7] text-black shadow-md select-none ${SIZES[size]} ${ring} ${
        dimmed ? 'opacity-40 saturate-50' : ''
      } ${className}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : cardNameLong(card)}
    >
      <span className={`absolute top-[0.2em] left-[0.35em] font-semibold leading-none ${red ? 'text-rose-600' : 'text-slate-900'}`}>
        {RANK_LABEL[rankOf(card)]}
        <span className="block">{SUIT_LABEL[suitOf(card)]}</span>
      </span>
      <span
        className={`absolute inset-0 grid place-items-center ${PIP[size]} ${
          red ? 'text-rose-600/85' : 'text-slate-900/85'
        }`}
        aria-hidden
      >
        {SUIT_LABEL[suitOf(card)]}
      </span>
      <span
        className={`absolute bottom-[0.2em] right-[0.35em] rotate-180 font-semibold leading-none ${
          red ? 'text-rose-600' : 'text-slate-900'
        }`}
        aria-hidden
      >
        {RANK_LABEL[rankOf(card)]}
        <span className="block">{SUIT_LABEL[suitOf(card)]}</span>
      </span>
    </div>
  );
}

/** Face-down card, used for the opponents' hands. */
export function CardBack({ size = 'sm', className = '' }: { size?: Size; className?: string }) {
  return (
    <div
      className={`bg-[#1f4d3d] ring-1 ring-black/30 shadow-md ${SIZES[size]} ${className}`}
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 3px, transparent 3px 7px)',
      }}
      aria-hidden
    />
  );
}

/** Inline card chip for use inside sentences and lists. */
export function CardChip({ card, className = '' }: { card: Card; className?: string }) {
  const red = SUIT_IS_RED[suitOf(card)];
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded bg-[#fdfcf7] px-1.5 py-0.5 font-semibold leading-none text-black ring-1 ring-black/15 ${className}`}
    >
      {RANK_LABEL[rankOf(card)]}
      <span className={red ? 'text-rose-600' : 'text-slate-900'}>{SUIT_LABEL[suitOf(card)]}</span>
    </span>
  );
}
