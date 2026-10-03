'use client';

import { useState } from 'react';
import { KEY_ICONS } from '@/lib/spades/table';

/**
 * The handoff gate. The player whose turn it is taps the key they chose in
 * private at setup; nobody else at the table knows which one that is.
 *
 * A wrong tap says only that it was wrong. Naming the right one, or marking
 * which keys are already taken, would hand the secret straight back.
 */
export function IconKeypad({
  name,
  onUnlock,
  onForgot,
}: {
  name: string;
  onUnlock: (icon: string) => boolean;
  onForgot: () => void;
}) {
  const [wrong, setWrong] = useState(0);
  const [shake, setShake] = useState(false);

  const tap = (icon: string) => {
    if (onUnlock(icon)) return;
    setWrong((n) => n + 1);
    setShake(true);
    setTimeout(() => setShake(false), 420);
  };

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-center text-base font-semibold">Pass the phone to {name}</h2>
      <p className="mt-1 text-center text-xs text-[color:var(--muted)]">
        {name}, tap your key to see your hand.
      </p>

      <div className={`mt-4 grid grid-cols-6 gap-2 ${shake ? 'keypad-shake' : ''}`}>
        {KEY_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => tap(icon)}
            aria-label="key"
            className="aspect-square rounded-xl bg-white/8 text-2xl transition hover:bg-white/16 active:scale-95"
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="mt-3 flex min-h-5 items-center justify-center">
        {wrong > 0 && (
          <p className="text-xs text-rose-300">
            Not your key. {wrong >= 3 ? 'Tap below if you have forgotten it.' : 'Try again.'}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onForgot}
        className="mt-1 w-full text-center text-xs text-[color:var(--muted)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
      >
        I forgot my key — let me pick a new one
      </button>
    </div>
  );
}

/**
 * Picking a key, done in private. Used at setup and again if someone forgets.
 * Keys are deliberately allowed to collide: telling a player that a key is
 * already taken would tell them something about somebody else's hand.
 */
export function IconPicker({
  name,
  onPick,
}: {
  name: string;
  onPick: (icon: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  if (chosen) {
    return (
      <div className="panel-rise rounded-2xl bg-[#132520] p-5 text-center ring-1 ring-white/10">
        <p className="text-sm text-[color:var(--muted)]">{name}, this is your key.</p>
        <p className="my-4 text-6xl">{chosen}</p>
        <p className="text-sm text-[color:var(--foreground)]/85">
          Remember it, and do not let anyone see it. You will tap it each time the phone
          comes round to you.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/20"
          >
            Pick a different one
          </button>
          <button
            type="button"
            onClick={() => onPick(chosen)}
            className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-rise rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
      <h2 className="text-center text-base font-semibold">{name}, choose your key</h2>
      <p className="mt-1 text-center text-xs text-[color:var(--muted)]">
        Keep it to yourself. Nobody else should see which one you pick.
      </p>
      <div className="mt-4 grid grid-cols-6 gap-2">
        {KEY_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => setChosen(icon)}
            aria-label="key option"
            className="aspect-square rounded-xl bg-white/8 text-2xl transition hover:bg-white/16 active:scale-95"
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
