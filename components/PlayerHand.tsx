'use client';

import { Card, cardNameLong, sortForDisplay } from '@/lib/spades/cards';
import { PlayingCard } from './PlayingCard';

export function PlayerHand({
  hand,
  legal,
  active,
  hint,
  restrictionNote,
  onPlay,
}: {
  hand: Card[];
  legal: Card[];
  active: boolean;
  hint: Card | null;
  restrictionNote: string | null;
  onPlay: (card: Card) => void;
}) {
  const legalSet = new Set(legal);
  const cards = sortForDisplay(hand);

  return (
    <div>
      <div className="hand-fit pt-6">
        <div className="hand-row">
          {cards.map((c) => {
            const playable = active && legalSet.has(c);
            return (
              <button
                key={c}
                type="button"
                disabled={!playable}
                onClick={() => onPlay(c)}
                aria-label={
                  active && !playable ? `${cardNameLong(c)} — not legal here` : cardNameLong(c)
                }
                className={`hand-card rounded-lg ${playable ? 'hand-card-playable cursor-pointer' : 'cursor-default'} focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]`}
              >
                <PlayingCard
                  card={c}
                  size="fluid"
                  decorative
                  dimmed={active && !playable}
                  highlight={hint === c ? 'best' : null}
                />
              </button>
            );
          })}
        </div>
      </div>
      {restrictionNote && (
        <p className="mt-3 text-center text-xs text-[color:var(--muted)]">{restrictionNote}</p>
      )}
    </div>
  );
}
