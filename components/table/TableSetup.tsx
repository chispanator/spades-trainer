'use client';

import { useState } from 'react';
import { Seat } from '@/lib/spades/cards';
import { Difficulty } from '@/lib/spades/game';
import {
  SEATS,
  SEAT_POSITION,
  TEAM_SEATS,
  TableRoster,
  defaultRoster,
  seatsNeedingKeys,
} from '@/lib/spades/table';
import { IconPicker } from './IconKeypad';

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-[color:var(--accent)] text-black' : 'bg-white/10 hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}

export function TableSetup({
  initial,
  onDone,
}: {
  initial: TableRoster | null;
  onDone: (roster: TableRoster) => void;
}) {
  const [roster, setRoster] = useState<TableRoster>(initial ?? defaultRoster());
  /** Null while filling in names; otherwise the seat currently choosing a key. */
  const [keying, setKeying] = useState<Seat | null>(null);
  const [handoff, setHandoff] = useState(false);

  const setSeat = (seat: Seat, patch: Partial<TableRoster['seats'][number]>) => {
    const seats = roster.seats.map((s, i) => (i === seat ? { ...s, ...patch } : s));
    setRoster({ ...roster, seats });
  };

  const namesOk = roster.seats.every((s) => s.name.trim().length > 0);

  // ---- the private pass: each player picks a key with nobody looking ----
  if (keying !== null) {
    const seat = keying;
    const name = roster.seats[seat].name;

    if (handoff) {
      return (
        <div className="panel-rise rounded-2xl bg-[#132520] p-6 text-center ring-1 ring-white/10">
          <p className="text-sm text-[color:var(--muted)]">Everyone else, look away.</p>
          <h2 className="mt-2 text-2xl font-semibold">Pass the phone to {name}</h2>
          <button
            type="button"
            onClick={() => setHandoff(false)}
            className="mt-6 w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110"
          >
            I am {name}
          </button>
        </div>
      );
    }

    return (
      <IconPicker
        name={name}
        onPick={(icon) => {
          const seats = roster.seats.map((s, i) => (i === seat ? { ...s, icon } : s));
          const next = { ...roster, seats };
          setRoster(next);
          const remaining = seatsNeedingKeys(next);
          if (remaining.length === 0) {
            onDone(next);
            return;
          }
          setKeying(remaining[0]);
          setHandoff(true);
        }}
      />
    );
  }

  // ---- the public part: who is playing, and on which side ----
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[#132520] p-4 ring-1 ring-white/10">
        <h2 className="text-base font-semibold">Who is playing?</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Partners sit opposite each other. Any seat nobody wants can be played by the
          computer.
        </p>

        {([0, 1] as const).map((team) => (
          <div key={team} className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
              Team {team + 1}
            </p>
            <div className="mt-1.5 space-y-2">
              {TEAM_SEATS[team].map((seat) => (
                <div key={seat} className="flex items-center gap-2 rounded-xl bg-white/5 p-2">
                  <span className="w-12 shrink-0 text-xs text-[color:var(--muted)]">
                    {SEAT_POSITION[seat]}
                  </span>
                  <input
                    value={roster.seats[seat].name}
                    onChange={(e) => setSeat(seat, { name: e.target.value })}
                    maxLength={14}
                    aria-label={`Name for the ${SEAT_POSITION[seat]} seat`}
                    className="min-w-0 flex-1 rounded-lg bg-black/25 px-2.5 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-[color:var(--accent)]"
                  />
                  <Chip
                    active={!roster.seats[seat].isAI}
                    onClick={() => setSeat(seat, { isAI: false })}
                  >
                    Person
                  </Chip>
                  <Chip
                    active={roster.seats[seat].isAI}
                    onClick={() => setSeat(seat, { isAI: true, icon: null })}
                  >
                    Computer
                  </Chip>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium">Game to</p>
            <div className="mt-1.5 flex gap-1.5">
              {[200, 350, 500].map((n) => (
                <Chip
                  key={n}
                  active={roster.targetScore === n}
                  onClick={() => setRoster({ ...roster, targetScore: n })}
                >
                  {n}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="font-medium">Nil bids</p>
            <div className="mt-1.5 flex gap-1.5">
              <Chip active={roster.allowNil} onClick={() => setRoster({ ...roster, allowNil: true })}>
                On
              </Chip>
              <Chip active={!roster.allowNil} onClick={() => setRoster({ ...roster, allowNil: false })}>
                Off
              </Chip>
            </div>
          </div>
          {roster.seats.some((s) => s.isAI) && (
            <div>
              <p className="font-medium">Computer players</p>
              <div className="mt-1.5 flex gap-1.5">
                {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map((d) => (
                  <Chip
                    key={d}
                    active={roster.difficulty === d}
                    onClick={() => setRoster({ ...roster, difficulty: d })}
                  >
                    {d === 'beginner' ? 'Casual' : d === 'intermediate' ? 'Solid' : 'Tough'}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={!namesOk}
        onClick={() => {
          const needing = seatsNeedingKeys(roster);
          if (needing.length === 0) {
            onDone(roster);
            return;
          }
          setKeying(needing[0]);
          setHandoff(true);
        }}
        className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {seatsNeedingKeys(roster).length > 0 ? 'Next: everyone picks a secret key' : 'Start playing'}
      </button>

      {SEATS.some((s) => !roster.seats[s].isAI && roster.seats[s].icon) && (
        <button
          type="button"
          onClick={() =>
            setRoster({ ...roster, seats: roster.seats.map((s) => ({ ...s, icon: null })) })
          }
          className="w-full text-center text-xs text-[color:var(--muted)] underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Reset everyone&apos;s key
        </button>
      )}
    </div>
  );
}
