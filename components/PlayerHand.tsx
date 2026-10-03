'use client';

import { useState } from 'react';
import { Card, cardName, cardNameLong, sortForDisplay } from '@/lib/spades/cards';
import { PlayingCard } from './PlayingCard';

export function PlayerHand({
  hand,
  legal,
  active,
  hint,
  restrictionNote,
  confirmPlays = false,
  onPlay,
}: {
  hand: Card[];
  legal: Card[];
  active: boolean;
  hint: Card | null;
  restrictionNote: string | null;
  /**
   * Require a second tap before a card leaves the hand. A played card cannot be
   * taken back, and on a phone being handed round a table the first tap is the
   * easy one to get wrong.
   */
  confirmPlays?: boolean;
  onPlay: (card: Card) => void;
}) {
  const [picked, setPicked] = useState<Card | null>(null);
  const legalSet = new Set(legal);
  const cards = sortForDisplay(hand);

  /*
   * Derived rather than cleared on a timer or an effect: once the hand changes
   * or the turn passes, whatever was picked is no longer a legal card, so the
   * selection simply stops counting. Nothing to reset, nothing to get stuck.
   */
  const selected = picked !== null && active && legalSet.has(picked) ? picked : null;

  const tap = (c: Card) => {
    if (!confirmPlays) {
      onPlay(c);
      return;
    }
    if (selected === c) {
      setPicked(null);
      onPlay(c);
      return;
    }
    setPicked(c);
  };

  return (
    <div>
      <div className="hand-fit pt-6">
        <div className="hand-row">
          {cards.map((c) => {
            const playable = active && legalSet.has(c);
            const isSelected = selected === c;
            return (
              <button
                key={c}
                type="button"
                disabled={!playable}
                onClick={() => tap(c)}
                aria-label={
                  active && !playable
                    ? `${cardNameLong(c)} — not legal here`
                    : isSelected
                      ? `${cardNameLong(c)} — selected, tap again to play`
                      : cardNameLong(c)
                }
                className={`hand-card rounded-lg ${
                  playable ? 'hand-card-playable cursor-pointer' : 'cursor-default'
                } ${isSelected ? 'hand-card-selected' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]`}
              >
                <PlayingCard
                  card={c}
                  size="fluid"
                  decorative
                  dimmed={active && !playable}
                  highlight={isSelected ? 'played' : hint === c ? 'best' : null}
                />
              </button>
            );
          })}
        </div>
      </div>

      {confirmPlays && selected !== null ? (
        <div className="panel-rise mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded-xl bg-white/10 px-4 py-3 text-sm font-medium transition hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              onPlay(selected);
            }}
            className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110"
          >
            Play {cardName(selected)}
          </button>
        </div>
      ) : (
        restrictionNote && (
          <p className="mt-3 text-center text-xs text-[color:var(--muted)]">{restrictionNote}</p>
        )
      )}

      {confirmPlays && selected === null && active && !restrictionNote && (
        <p className="mt-3 text-center text-xs text-[color:var(--muted)]">
          Tap a card to pick it, then confirm.
        </p>
      )}
    </div>
  );
}
