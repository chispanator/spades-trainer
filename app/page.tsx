'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, SEAT_NAME, SUIT_NAME, suitOf } from '@/lib/spades/cards';
import { BidReview, HandCountReview, PlayReview, reviewHandCount } from '@/lib/spades/coach';
import { TrickEstimate } from '@/lib/spades/mc';
import {
  GameState,
  HUMAN,
  aiBid,
  aiChooseCard,
  attachBidReview,
  bidEstimate,
  dealNextHand,
  evaluateFor,
  hintSamples,
  legalFor,
  newGame,
  playCard,
  resolveTrick,
  reviewHumanBid,
  reviewHumanPlay,
  sessionStats,
  submitBid,
} from '@/lib/spades/game';
import { GameTable } from '@/components/GameTable';
import { HandCountResult, HandCountWorksheet } from '@/components/HandCount';
import { PlayerHand } from '@/components/PlayerHand';
import { AccuracyBar, BidFeedback, FeedbackCard, HintCard, ReviewList } from '@/components/Coach';
import {
  BidPanel,
  EnginePanel,
  HandSummary,
  RulesPanel,
  Scoreboard,
  Settings,
  SettingsPanel,
  StartScreen,
} from '@/components/Panels';

const SUIT_NAME_LOWER = SUIT_NAME.map((s) => s.toLowerCase());

const DEFAULT_SETTINGS: Settings = {
  difficulty: 'intermediate',
  coachMode: 'mistakes',
  allowNil: true,
  targetScore: 350,
  countPrompt: true,
};

const AI_BID_DELAY = 420;
const AI_PLAY_DELAY = 560;
const TRICK_HOLD = 1500;

export default function Page() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [game, setGame] = useState<GameState | null>(null);
  const [pendingReview, setPendingReview] = useState<PlayReview | null>(null);
  const [pendingBidReview, setPendingBidReview] = useState<BidReview | null>(null);
  const [hint, setHint] = useState<Card | null>(null);
  const [lastReview, setLastReview] = useState<PlayReview | null>(null);
  const [peek, setPeek] = useState<TrickEstimate | null>(null);
  const [assists, setAssists] = useState(0);
  // Hand counting: 'idle' until the player opens the worksheet (or the setting
  // opens it for them), then 'result', then out of the way for the bid itself.
  const [countPhase, setCountPhase] = useState<'idle' | 'entering' | 'result' | 'done'>('idle');
  const [countReview, setCountReview] = useState<HandCountReview | null>(null);
  const [countMisses, setCountMisses] = useState<number[]>([]);
  const blocked = pendingReview !== null || pendingBidReview !== null;
  // Purely derived: an opponent is "thinking" whenever it is their turn to act.
  const thinking =
    game !== null && game.phase === 'playing' && game.turn !== HUMAN && !blocked;

  // --- the three opponents bid ---
  useEffect(() => {
    if (!game || game.phase !== 'bidding' || game.turn === HUMAN || blocked) return;
    const seat = game.turn;
    const t = setTimeout(() => {
      setGame((g) => (g && g.phase === 'bidding' && g.turn === seat ? submitBid(g, seat, aiBid(g, seat)) : g));
    }, AI_BID_DELAY);
    return () => clearTimeout(t);
  }, [game, blocked]);

  // --- the three opponents play ---
  useEffect(() => {
    if (!game || game.phase !== 'playing' || game.turn === HUMAN || blocked) return;
    const seat = game.turn;
    const t = setTimeout(() => {
      setGame((g) => (g && g.phase === 'playing' && g.turn === seat ? playCard(g, aiChooseCard(g, seat)) : g));
    }, AI_PLAY_DELAY);
    return () => clearTimeout(t);
  }, [game, blocked]);

  // --- a finished trick stays on the table for a moment before it is cleared ---
  useEffect(() => {
    if (!game || game.phase !== 'trickComplete' || blocked) return;
    const t = setTimeout(() => {
      setGame((g) => (g && g.phase === 'trickComplete' ? resolveTrick(g) : g));
    }, TRICK_HOLD);
    return () => clearTimeout(t);
  }, [game, blocked]);

  const handlePlay = useCallback(
    (card: Card) => {
      if (!game || game.phase !== 'playing' || game.turn !== HUMAN) return;
      if (!legalFor(game, HUMAN).includes(card)) return;
      const review = reviewHumanPlay(game, card);
      setHint(null);
      setGame(playCard(game, card, review));
      setLastReview(review);
      // "Only on mistakes" keeps the game moving and speaks up when it matters;
      // a sound play still gets a verdict, just without stopping the hand.
      const interrupt =
        settings.coachMode === 'instant' ||
        (settings.coachMode === 'mistakes' &&
          review.hadChoice &&
          (review.grade === 'inaccuracy' || review.grade === 'mistake' || review.grade === 'blunder'));
      if (interrupt) setPendingReview(review);
    },
    [game, settings.coachMode]
  );

  const handleBid = useCallback(
    (bid: number) => {
      if (!game || game.phase !== 'bidding' || game.turn !== HUMAN) return;
      const review = reviewHumanBid(game, bid);
      setPeek(null);
      setGame(submitBid(attachBidReview(game, review), HUMAN, bid));
      if (settings.coachMode !== 'endOfHand') setPendingBidReview(review);
    },
    [game, settings.coachMode]
  );

  const handleHint = useCallback(() => {
    if (!game || game.phase !== 'playing' || game.turn !== HUMAN) return;
    const res = evaluateFor(game, HUMAN, hintSamples(legalFor(game, HUMAN).length));
    if (res.candidates.length) setHint(res.candidates[0].card);
    setAssists((n) => n + 1);
  }, [game]);

  const handlePeek = useCallback(() => {
    if (!game) return;
    setPeek(bidEstimate(game, HUMAN));
    setAssists((n) => n + 1);
  }, [game]);

  const handleCountSubmit = useCallback(
    (counts: number[]) => {
      if (!game) return;
      const est = bidEstimate(game, HUMAN);
      const review = reviewHandCount(counts, est);
      setPeek(est); // having counted, the player has earned the number
      setCountReview(review);
      setCountMisses((m) => [...m, review.delta]);
      setCountPhase('result');
    },
    [game]
  );

  const resetHandCount = useCallback(() => {
    setCountPhase('idle');
    setCountReview(null);
    setPeek(null);
  }, []);

  const startNewGame = useCallback(() => {
    setPendingReview(null);
    setPendingBidReview(null);
    setLastReview(null);
    setHint(null);
    setAssists(0);
    resetHandCount();
    setGame(
      newGame({
        seed: Math.floor(Math.random() * 2 ** 31),
        targetScore: settings.targetScore,
        difficulty: settings.difficulty,
        allowNil: settings.allowNil,
      })
    );
  }, [settings, resetHandCount]);

  const allReviews = useMemo(() => {
    if (!game) return [];
    return [...game.history.flatMap((h) => h.reviews), ...game.reviews];
  }, [game]);
  const stats = useMemo(() => sessionStats(allReviews), [allReviews]);

  if (!game) {
    return <StartScreen settings={settings} onChange={setSettings} onStart={startNewGame} />;
  }

  const myTurn = game.phase === 'playing' && game.turn === HUMAN && !blocked;
  const legal = game.phase === 'playing' ? legalFor(game, HUMAN) : [];
  const restrictionNote =
    myTurn && legal.length < game.hands[HUMAN].length
      ? game.trick.length === 0
        ? 'Dimmed cards are spades — nobody may lead one until spades have been broken.'
        : `Dimmed cards are not legal — you have to follow ${SUIT_NAME_LOWER[suitOf(game.trick[0].card)]}.`
      : null;
  const myBidTurn = game.phase === 'bidding' && game.turn === HUMAN && !blocked;
  // The worksheet opens on request, or straight away when the setting asks for it.
  const showWorksheet =
    myBidTurn && (countPhase === 'entering' || (settings.countPrompt && countPhase === 'idle'));
  const showBidPanel = myBidTurn && !showWorksheet && countPhase !== 'result';
  const meanMiss = countMisses.length
    ? countMisses.reduce((a, b) => a + b, 0) / countMisses.length
    : 0;
  const bias =
    Math.abs(meanMiss) < 0.25
      ? 'balanced'
      : meanMiss > 0
        ? `${meanMiss.toFixed(1)} optimistic`
        : `${Math.abs(meanMiss).toFixed(1)} cautious`;

  const needsAction =
    blocked ||
    (game.phase === 'bidding' && game.turn === HUMAN) ||
    game.phase === 'handComplete' ||
    game.phase === 'gameComplete';

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Spades Trainer</h1>
          <p className="text-xs text-[color:var(--muted)]">
            Play a hand. Every card you choose is graded against a simulation of the deals your
            opponents could be holding.
          </p>
        </div>
        {stats.totalDecisions > 0 && (
          <div className="w-full max-w-xs">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-[color:var(--muted)]">
                {stats.totalDecisions} decision{stats.totalDecisions === 1 ? '' : 's'}
              </span>
              <span className="font-semibold">{Math.round(stats.accuracy * 100)}% sound</span>
            </div>
            <AccuracyBar stats={stats} />
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <GameTable game={game} thinking={thinking} />

          <PlayerHand
            hand={game.hands[HUMAN]}
            legal={legal}
            active={myTurn}
            hint={hint}
            restrictionNote={restrictionNote}
            onPlay={handlePlay}
          />

          <div className="mt-4 flex min-h-9 items-center justify-center gap-3">
            {myTurn && !hint && (
              <button
                type="button"
                onClick={handleHint}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/20"
              >
                Show me the best card
              </button>
            )}
            {myTurn && (
              <p className="text-sm text-[color:var(--muted)]">
                {game.trick.length === 0 ? 'Your lead.' : 'Your turn.'}
              </p>
            )}
            {game.phase === 'bidding' && game.turn !== HUMAN && !blocked && (
              <p className="text-sm text-[color:var(--muted)]">{SEAT_NAME[game.turn]} is bidding…</p>
            )}
          </div>

          {hint !== null && (
            <div className="mt-2">
              <HintCard card={hint} onDismiss={() => setHint(null)} />
            </div>
          )}
        </section>

        <aside className="space-y-3">
          {/*
            Anything that needs a click sits in this block. On a phone the
            sidebar falls below the fold, so it is pinned to the bottom of the
            screen there and only returns to the flow on a wide layout.
          */}
          {needsAction && (
            <div className="fixed inset-x-0 bottom-0 z-30 max-h-[72dvh] overflow-y-auto border-t border-white/10 bg-[color:var(--background)]/95 p-3 backdrop-blur lg:static lg:max-h-none lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <div className="mx-auto max-w-lg space-y-3 lg:max-w-none">
                {pendingBidReview && (
                  <BidFeedback review={pendingBidReview} onContinue={() => setPendingBidReview(null)} />
                )}

                {pendingReview && (
                  <FeedbackCard review={pendingReview} onContinue={() => setPendingReview(null)} />
                )}

                {showWorksheet && (
                  <HandCountWorksheet
                    hand={game.hands[HUMAN]}
                    onSubmit={handleCountSubmit}
                    onSkip={() => setCountPhase('done')}
                  />
                )}

                {countPhase === 'result' && countReview && peek && (
                  <HandCountResult
                    review={countReview}
                    estimate={peek}
                    onDone={() => setCountPhase('done')}
                  />
                )}

                {showBidPanel && (
                  <BidPanel
                    onBid={handleBid}
                    allowNil={game.options.allowNil}
                    estimate={peek}
                    onPeek={handlePeek}
                    peeked={peek !== null}
                    onCount={countReview ? undefined : () => setCountPhase('entering')}
                  />
                )}

                {(game.phase === 'handComplete' || game.phase === 'gameComplete') && game.lastHand && (
                  <HandSummary
                    result={game.lastHand}
                    isGameOver={game.phase === 'gameComplete'}
                    scores={game.scores}
                    targetScore={game.options.targetScore}
                    onNext={() => {
                      setPendingReview(null);
                      setPendingBidReview(null);
                      setLastReview(null);
                      resetHandCount();
                      if (game.phase === 'gameComplete') startNewGame();
                      else setGame(dealNextHand(game));
                    }}
                  >
                    <div className="mt-4">
                      <h3 className="mb-2 text-sm font-semibold">Your decisions this hand</h3>
                      {game.lastHand.bidReview && (
                        <div className="mb-2">
                          <BidFeedback review={game.lastHand.bidReview} />
                        </div>
                      )}
                      <ReviewList reviews={game.lastHand.reviews} />
                    </div>
                  </HandSummary>
                )}
              </div>
            </div>
          )}

          {!pendingReview && lastReview && game.phase === 'playing' && (
            <FeedbackCard review={lastReview} onContinue={() => {}} autoAdvance />
          )}

          <Scoreboard game={game} />

          {countMisses.length > 0 && (
            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <h2 className="text-sm font-semibold">Your hand counting</h2>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[color:var(--muted)]">Hands counted</dt>
                  <dd className="tabular-nums">{countMisses.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[color:var(--muted)]">Average miss</dt>
                  <dd className="tabular-nums">
                    {(
                      countMisses.reduce((a, b) => a + Math.abs(b), 0) / countMisses.length
                    ).toFixed(1)}{' '}
                    tricks
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[color:var(--muted)]">Leaning</dt>
                  <dd className="tabular-nums">{bias}</dd>
                </div>
              </dl>
            </div>
          )}

          {assists > 0 && (
            <p className="px-1 text-xs text-[color:var(--muted)]">
              You have asked the engine for help {assists} time{assists === 1 ? '' : 's'} this game.
            </p>
          )}

          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onNewGame={startNewGame}
            disabled={false}
          />
          <EnginePanel />
          <RulesPanel />
        </aside>
      </div>
    </main>
  );
}
