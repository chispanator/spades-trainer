'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, Seat, suitOf, SUIT_NAME } from '@/lib/spades/cards';
import {
  GameState,
  aiBid,
  aiChooseCard,
  dealNextHand,
  legalFor,
  newGame,
  playCard,
  resolveTrick,
  submitBid,
} from '@/lib/spades/game';
import {
  TableRoster,
  isReady,
  loadRoster,
  saveRoster,
} from '@/lib/spades/table';
import { GameTable } from '@/components/GameTable';
import { ModeSwitch } from '@/components/ModeSwitch';
import { PlayerHand } from '@/components/PlayerHand';
import { IconKeypad, IconPicker } from '@/components/table/IconKeypad';
import { TableSetup } from '@/components/table/TableSetup';
import {
  HandoffStrip,
  TableBidPad,
  TableHandSummary,
  TrickReview,
  TableScore,
} from '@/components/table/TablePanels';

const AI_DELAY = 650;

type Screen = 'landing' | 'setup' | 'playing';

export default function TablePage() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [roster, setRoster] = useState<TableRoster | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [rekeying, setRekeying] = useState<Seat | null>(null);

  const startGame = useCallback((r: TableRoster) => {
    setRoster(r);
    saveRoster(r);
    setGame(
      newGame({
        seed: Math.floor(Math.random() * 2 ** 31),
        targetScore: r.targetScore,
        difficulty: r.difficulty,
        allowNil: r.allowNil,
      })
    );
    setUnlocked(false);
    setScreen('playing');
  }, []);

  const turn = game?.turn ?? 0;
  const seatIsAI = roster ? roster.seats[turn].isAI : false;
  const busy = rekeying !== null;

  // ---- computer seats bid and play on their own ----
  useEffect(() => {
    if (!game || !roster || busy) return;
    if (game.phase !== 'bidding' && game.phase !== 'playing') return;
    if (!roster.seats[game.turn].isAI) return;
    const seat = game.turn;
    const phase = game.phase;
    const t = setTimeout(() => {
      setGame((g) => {
        if (!g || g.turn !== seat || g.phase !== phase) return g;
        return phase === 'bidding' ? submitBid(g, seat, aiBid(g, seat)) : playCard(g, aiChooseCard(g, seat));
      });
    }, AI_DELAY);
    return () => clearTimeout(t);
  }, [game, roster, busy]);

  /*
    There is deliberately no auto-play for a forced card here, though the solo
    trainer can afford one. Skipping a player's turn is itself a signal: if the
    phone never reaches you, the table learns you held exactly one legal card.
    At a real table nobody knows that, so everyone takes every turn, even when
    the hand plays itself.

    A finished trick is not cleared on a timer either. Whoever played the fourth
    card is holding the phone, so a trick that vanishes after a second and a half
    is a trick only one player ever saw. It waits to be dismissed instead.
  */

  const handlePlay = useCallback(
    (card: Card) => {
      if (!game || game.phase !== 'playing') return;
      if (!legalFor(game, game.turn).includes(card)) return;
      setUnlocked(false);
      setGame(playCard(game, card));
    },
    [game]
  );

  const handleBid = useCallback(
    (bid: number) => {
      if (!game || game.phase !== 'bidding') return;
      setUnlocked(false);
      setGame(submitBid(game, game.turn, bid));
    },
    [game]
  );

  // ------------------------------------------------------------- screens --

  if (screen === 'landing') {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center px-4 py-10">
        <div className="w-full">
          <h1 className="text-3xl font-semibold tracking-tight">Round the Table</h1>
          <p className="mt-2 text-sm text-[color:var(--foreground)]/80">
            One phone, passed around. Everyone picks a secret key at the start, and your hand
            only appears when your own key is tapped — so the phone can go round the table
            without anyone seeing anybody else&apos;s cards.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-[color:var(--muted)]">
            <li>· Two, three or four players; the computer fills any empty seat.</li>
            <li>· Nobody else knows your key, so nobody else can open your hand.</li>
            <li>· When only one card is legal, it is played for you and the phone stays put.</li>
          </ul>

          <button
            type="button"
            onClick={() => {
              const saved = loadRoster();
              if (saved && isReady(saved)) {
                startGame(saved);
              } else {
                setRoster(saved);
                setScreen('setup');
              }
            }}
            className="mt-6 w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-base font-semibold text-black transition hover:brightness-110"
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => {
              setRoster(loadRoster());
              setScreen('setup');
            }}
            className="mt-2 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium transition hover:bg-white/20"
          >
            Set up the table
          </button>
          <div className="mt-6">
            <p className="mb-2 text-center text-xs text-[color:var(--muted)]">Two ways to play</p>
            <ModeSwitch current="table" />
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'setup' || !game || !roster) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Set up the table</h1>
        <TableSetup initial={roster} onDone={startGame} />
      </main>
    );
  }

  // ---------------------------------------------------------- the table --

  const player = roster.seats[turn];
  const names = roster.seats.map((s) => s.name);
  const myTurnHuman = !seatIsAI && (game.phase === 'bidding' || game.phase === 'playing');
  /*
    No choice means no handoff, so do not even raise the keypad - otherwise it
    flashes up and the card plays itself a moment later, which looks like the
    app ignoring you. Nothing is said about why; the card landing is all the
    table sees, exactly as if the player had chosen it.
  */
  const viewSeat = unlocked && myTurnHuman ? turn : null;
  const legal = game.phase === 'playing' && unlocked ? legalFor(game, turn) : [];
  const restrictionNote =
    unlocked && game.phase === 'playing' && legal.length < game.hands[turn].length
      ? game.trick.length === 0
        ? 'Dimmed cards are spades — nobody may lead one until spades have been broken.'
        : `Dimmed cards are not legal — you have to follow ${SUIT_NAME[suitOf(game.trick[0].card)].toLowerCase()}.`
      : null;

  /*
    While the phone is in transit the keypad is the only thing anyone needs, and
    on a phone it is the one control that must never need scrolling to. So the
    handoff gets its own screen: a compact strip of what the table may see, and
    the keys. The full board comes back the moment the hand is open.
  */
  const awaitingKey = myTurnHuman && !unlocked && rekeying === null;
  if (awaitingKey) {
    return (
      <main className="mx-auto w-full max-w-md px-3 py-4">
        <HandoffStrip game={game} roster={roster} />
        <div className="mt-3">
          <IconKeypad
            name={player.name}
            onUnlock={(icon) => {
              if (icon !== player.icon) return false;
              setUnlocked(true);
              return true;
            }}
            onForgot={() => setRekeying(turn)}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">Round the Table</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScreen('setup')}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20"
          >
            Players
          </button>
          <ModeSwitch
            current="table"
            size="compact"
            guard={
              game.phase !== 'gameComplete'
                ? 'Leave the table? This game is not saved, so the hand will be lost.'
                : null
            }
          />
        </div>
      </div>

      <TableScore game={game} roster={roster} />

      <div className="mt-3">
        <GameTable
          game={game}
          thinking={seatIsAI && (game.phase === 'playing' || game.phase === 'bidding')}
          viewSeat={viewSeat}
          seatLabels={names}
        />
      </div>

      {/* Your hand, once your own key has opened it. */}
      {unlocked && myTurnHuman && (
        <PlayerHand
          hand={game.hands[turn]}
          legal={legal}
          active={game.phase === 'playing'}
          hint={null}
          restrictionNote={restrictionNote}
          confirmPlays
          onPlay={handlePlay}
        />
      )}

      <div className="mt-3 space-y-3">
        {rekeying !== null ? (
          <IconPicker
            name={roster.seats[rekeying].name}
            onPick={(icon) => {
              const seats = roster.seats.map((s, i) => (i === rekeying ? { ...s, icon } : s));
              const next = { ...roster, seats };
              setRoster(next);
              saveRoster(next);
              setRekeying(null);
              setUnlocked(true);
            }}
          />
        ) : (
          <>
            {game.phase === 'trickComplete' && (
              <TrickReview
                game={game}
                roster={roster}
                onNext={() => setGame(resolveTrick(game))}
              />
            )}

            {unlocked && game.phase === 'bidding' && (
              <TableBidPad
                name={player.name}
                allowNil={game.options.allowNil}
                onBid={handleBid}
              />
            )}

            {(game.phase === 'handComplete' || game.phase === 'gameComplete') && game.lastHand && (
              <TableHandSummary
                result={game.lastHand}
                roster={roster}
                isGameOver={game.phase === 'gameComplete'}
                scores={game.scores}
                onNext={() => {
                  setUnlocked(false);
                  if (game.phase === 'gameComplete') startGame(roster);
                  else setGame(dealNextHand(game));
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
