import { LIVE_ROUND_RESULT_MS, QUESTION_DURATION_MS, displayedSeconds, remainingAt } from '@quiz-gomes/domain';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { feedback } from '../lib/feedback.js';
import { playDuelFlip, takeDuelOrigin, type DuelSeat } from '../lib/match-handoff.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;
const OPTION_KEYS: Record<string, number> = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
const STREAK_VISIBLE_FROM = 2;
const DUEL_SEATS: readonly DuelSeat[] = ['viewer', 'opponent'];
const ROUND_OPPONENT_REVEAL_MS = 250;
const ROUND_SCORE_REVEAL_MS = 550;

/**
 * Moldura de altura fixa: o layout não pula quando a foto chega e as
 * alternativas ficam sempre no mesmo lugar. Tocar amplia sem pausar o
 * relógio; se a foto falhar, a pergunta segue só com o texto.
 */
function QuestionMedia({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);
  if (failed) return null;
  return (
    <>
      <button aria-label="Ampliar a foto da pergunta" className="question-media" onClick={() => setZoomed(true)} type="button">
        <img alt="Foto da pergunta" decoding="async" draggable={false} onError={() => setFailed(true)} src={url} />
      </button>
      {zoomed && (
        <button aria-label="Fechar a foto ampliada" className="question-media-zoom" onClick={() => setZoomed(false)} type="button">
          <img alt="Foto da pergunta ampliada" draggable={false} src={url} />
          <span aria-hidden="true">× Fechar · o tempo continua correndo</span>
        </button>
      )}
    </>
  );
}

interface MatchParticipantView {
  customAvatarUrl?: string | null;
  frameId?: string | null;
  name: string;
  photoUrl?: string | null;
}

interface MatchTimerStyle extends CSSProperties {
  '--timer-duration': string;
  '--timer-from-ratio': number;
  '--timer-reduced-ratio': number;
}

interface MatchScreenStyle extends CSSProperties {
  '--match-question-delay': string;
  '--match-result-duration': string;
  '--round-opponent-reveal-delay': string;
  '--round-score-reveal-delay': string;
}

export interface MatchQuestionView {
  imageUrl?: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

export interface MatchResolutionView {
  correctOption: number;
  opponent: {
    correct: boolean;
    selectedOption: number | null;
  };
  viewer: {
    correct: boolean;
    roundScore: number;
    selectedOption: number | null;
  };
}

function normalizedRemaining(remainingMs: number): number {
  return Math.max(0, Math.min(QUESTION_DURATION_MS, remainingMs));
}

function MatchTimer({
  deadlineMs,
  initialRemainingMs,
  onExpire,
  resolved,
}: {
  deadlineMs: number;
  initialRemainingMs: number;
  onExpire: () => void;
  resolved: boolean;
}) {
  const animationStartRemaining = normalizedRemaining(resolved ? 0 : initialRemainingMs);
  const [snapshot, setSnapshot] = useState(() => ({
    remainingMs: animationStartRemaining,
    seconds: displayedSeconds(animationStartRemaining),
  }));

  useEffect(() => {
    let timer: number | null = null;
    let expired = false;
    const update = () => {
      const remainingMs = normalizedRemaining(resolved ? 0 : remainingAt(Date.now(), deadlineMs));
      const seconds = displayedSeconds(remainingMs);
      setSnapshot((current) => (
        current.remainingMs === remainingMs && current.seconds === seconds
          ? current
          : { remainingMs, seconds }
      ));
      if (remainingMs <= 0) {
        if (!expired) {
          expired = true;
          onExpire();
        }
        return;
      }
      const remainder = remainingMs % 1_000;
      const untilNextSecond = remainder === 0 ? 1_000 : remainder;
      timer = window.setTimeout(update, Math.min(1_000, Math.max(16, untilNextSecond)));
    };

    update();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deadlineMs, onExpire, resolved]);

  const running = !resolved && animationStartRemaining > 0;
  const urgent = running && snapshot.seconds > 0 && snapshot.seconds <= 3;
  const style: MatchTimerStyle = {
    '--timer-duration': `${Math.max(1, animationStartRemaining)}ms`,
    '--timer-from-ratio': animationStartRemaining / QUESTION_DURATION_MS,
    '--timer-reduced-ratio': snapshot.remainingMs / QUESTION_DURATION_MS,
  };

  return (
    <div className={`match-timer${urgent ? ' match-timer--urgent' : ''}`} role="timer" aria-label={`${snapshot.seconds} segundos restantes`}>
      <span
        aria-hidden="true"
        className={`match-timer__bar${running ? ' match-timer__bar--running' : ''}`}
        key={`${resolved ? 'resolved' : 'running'}:${deadlineMs}`}
        style={style}
      />
      <strong aria-hidden="true" key={urgent ? snapshot.seconds : 'calm'}>{snapshot.seconds}</strong>
    </div>
  );
}

/** Anel de contagem acima da pergunta: mesma deadline do timer, sem decidir expiração. */
function MatchTimerRing({ deadlineMs, initialRemainingMs, resolved, verdict }: {
  deadlineMs: number;
  initialRemainingMs: number;
  resolved: boolean;
  verdict: 'correct' | 'none' | 'wrong';
}) {
  const start = normalizedRemaining(resolved ? 0 : initialRemainingMs);
  const [seconds, setSeconds] = useState(() => displayedSeconds(start));
  useEffect(() => {
    if (resolved) return undefined;
    let timer: number | null = null;
    const update = () => {
      const remainingMs = normalizedRemaining(remainingAt(Date.now(), deadlineMs));
      setSeconds(displayedSeconds(remainingMs));
      if (remainingMs <= 0) return;
      const remainder = remainingMs % 1_000;
      timer = window.setTimeout(update, Math.min(1_000, Math.max(16, remainder === 0 ? 1_000 : remainder)));
    };
    update();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [deadlineMs, resolved]);
  const running = !resolved && start > 0;
  const style = {
    '--ring-duration': `${Math.max(1, start)}ms`,
    '--ring-from': start / QUESTION_DURATION_MS,
    '--ring-now': (seconds * 1_000) / QUESTION_DURATION_MS,
  } as CSSProperties;
  const urgent = running && seconds > 0 && seconds <= 3;
  return (
    <span aria-hidden="true" className={`timer-ring${running ? ' timer-ring--running' : ''}${urgent ? ' timer-ring--urgent' : ''}${resolved ? ` timer-ring--${verdict}` : ''}`} style={style}>
      <svg viewBox="0 0 64 64">
        <circle className="timer-ring__track" cx="32" cy="32" r="28" />
        <circle className="timer-ring__fill" cx="32" cy="32" pathLength="100" r="28" />
      </svg>
      <strong key={resolved ? verdict : urgent ? seconds : 'calm'}>{resolved ? { correct: '✓', none: '–', wrong: '×' }[verdict] : seconds}</strong>
    </span>
  );
}

export function MatchScreen({
  deadlineMs,
  duelRoomId,
  onAnswer,
  opponent,
  opponentAnswered = false,
  opponentPending = false,
  opponentScore,
  player,
  playerScore,
  preparing = false,
  question,
  questionPresentationDelayMs = 0,
  remainingMs,
  resolution,
  round,
  selectedOption,
  streak = 0,
}: {
  deadlineMs: number;
  /** Sala desta partida; habilita a continuidade dos retratos vindos do lobby na primeira rodada. */
  duelRoomId?: string | undefined;
  onAnswer: (option: number) => void;
  opponent: MatchParticipantView;
  opponentAnswered?: boolean;
  /** Metade do primeiro jogador assíncrono: o adversário ainda não jogou nenhuma rodada. */
  opponentPending?: boolean;
  opponentScore: number;
  player: MatchParticipantView;
  playerScore: number;
  preparing?: boolean;
  question: MatchQuestionView;
  questionPresentationDelayMs?: number;
  remainingMs: number;
  resolution?: MatchResolutionView | undefined;
  round?: { number: number; total: number } | undefined;
  selectedOption?: number | null | undefined;
  /** Acertos seguidos do jogador até a última rodada resolvida; só apresentação. */
  streak?: number;
}) {
  const [localSelected, setLocalSelected] = useState<number | null>(selectedOption ?? resolution?.viewer.selectedOption ?? null);
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const [displayedScores, setDisplayedScores] = useState(() => ({
    opponent: opponentScore,
    player: playerScore,
  }));
  const [questionEntranceDelayMs] = useState(questionPresentationDelayMs);
  const scoreboardRef = useRef<HTMLElement>(null);
  const resolved = resolution !== undefined;
  const roundNumber = round?.number;
  const selected = resolved ? resolution.viewer.selectedOption : selectedOption ?? localSelected;
  const visuallyExpired = expiredDeadline === deadlineMs || remainingMs <= 0;
  const opponentSelected = resolution?.opponent.selectedOption ?? null;
  const handleExpire = useCallback(() => setExpiredDeadline(deadlineMs), [deadlineMs]);
  const answersLocked = preparing || selected !== null || visuallyExpired || resolved;
  const choose = useCallback((index: number) => {
    feedback('tap');
    setLocalSelected(index);
    onAnswer(index);
  }, [onAnswer]);

  useEffect(() => {
    if (answersLocked) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const index = OPTION_KEYS[event.key.toLowerCase()];
      if (index === undefined) return;
      event.preventDefault();
      choose(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answersLocked, choose]);

  const viewerAnsweredThisRound = resolution?.viewer.selectedOption !== null && resolution?.viewer.selectedOption !== undefined;
  const viewerCorrect = resolution?.viewer.correct;
  useEffect(() => {
    if (!resolved || !viewerAnsweredThisRound) return;
    feedback(viewerCorrect === true ? 'correct' : 'wrong');
  }, [resolved, viewerAnsweredThisRound, viewerCorrect]);
  const screenStyle: MatchScreenStyle = {
    '--match-question-delay': `${questionEntranceDelayMs}ms`,
    '--match-result-duration': `${LIVE_ROUND_RESULT_MS}ms`,
    '--round-opponent-reveal-delay': `${ROUND_OPPONENT_REVEAL_MS}ms`,
    '--round-score-reveal-delay': `${ROUND_SCORE_REVEAL_MS}ms`,
  };

  useEffect(() => {
    // Só a primeira rodada continua o movimento do lobby, e a origem é consumida uma única vez.
    if (duelRoomId === undefined || roundNumber !== 1) return undefined;
    const timer = window.setTimeout(() => {
      const scoreboard = scoreboardRef.current;
      if (scoreboard === null) return;
      for (const seat of DUEL_SEATS) {
        playDuelFlip(
          scoreboard.querySelector<HTMLElement>(`[data-duel-flip="${seat}"]`),
          takeDuelOrigin(duelRoomId, 'lobby', seat),
        );
      }
      // A apresentação da rodada cobre a tela até aqui; antes disso o movimento seria invisível.
    }, Math.max(0, questionEntranceDelayMs));
    return () => window.clearTimeout(timer);
  }, [duelRoomId, questionEntranceDelayMs, roundNumber]);

  useEffect(() => {
    if (!resolved) return undefined;
    const timer = window.setTimeout(() => {
      setDisplayedScores((current) => (
        current.opponent === opponentScore && current.player === playerScore
          ? current
          : { opponent: opponentScore, player: playerScore }
      ));
    }, ROUND_SCORE_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [opponentScore, playerScore, resolved]);

  return (
    <main
      aria-hidden={preparing || undefined}
      className={`match-screen${resolved ? ' match-screen--resolved' : ''}${preparing ? ' match-screen--preparing' : ''}`}
      style={screenStyle}
    >
      <header className="match-scoreboard" ref={scoreboardRef}>
        <div className="opponent-chip">
          <span
            aria-label={opponentPending
              ? 'Adversário ainda não jogou'
              : opponentAnswered ? 'Adversário respondeu' : 'Adversário pensando'}
            className={`status-dot ${opponentAnswered ? 'status-dot--answered' : ''}`}
            role="status"
          />
          <AvatarFrame flipId="opponent" frameId={opponent.frameId}>
            <Avatar customUrl={opponent.customAvatarUrl} googleUrl={opponent.photoUrl} name={opponent.name} size="small" />
          </AvatarFrame>
          <span className="match-scoreboard__copy">
            <small>{opponent.name}</small>
            <strong
              aria-label={opponentPending ? 'Adversário ainda não jogou' : undefined}
              aria-live="polite"
              key={opponentPending ? 'pending' : displayedScores.opponent}
            >{opponentPending ? '—' : displayedScores.opponent}</strong>
          </span>
        </div>
        {round !== undefined && (
          <span className="round-counter">
            <span>Pergunta {round.number} de {round.total}</span>
            <span aria-hidden="true" className="round-steps">
              {Array.from({ length: round.total }, (_, index) => (
                <i data-step={index + 1 < round.number ? 'done' : index + 1 === round.number ? 'current' : 'next'} key={index} />
              ))}
            </span>
          </span>
        )}
        <div className="player-chip">
          <span className="match-scoreboard__copy">
            <small>Você</small>
            <strong aria-live="polite" key={displayedScores.player}>{displayedScores.player}</strong>
            {streak >= STREAK_VISIBLE_FROM && (
              <span aria-label={`${streak} acertos seguidos`} className="streak-chip" key={streak}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.4-2.1-5.6-3.6-7.4-.4 1.9-1.4 3-2.6 3.4.3-3.5-1.3-6.6-4.3-9.2.2 3.4-1.4 5.3-3 7.2C4.3 10.7 5 13.1 5 15.2 5 19.3 8 22 12 22Z" /></svg>
                {streak}
              </span>
            )}
            {resolved && resolution.viewer.roundScore > 0 && (
              <span aria-label={`${resolution.viewer.roundScore} pontos ganhos`} className="score-gain">
                +{resolution.viewer.roundScore}
              </span>
            )}
          </span>
          <AvatarFrame flipId="viewer" frameId={player.frameId}>
            <Avatar customUrl={player.customAvatarUrl} googleUrl={player.photoUrl} name={player.name} size="small" />
          </AvatarFrame>
        </div>
      </header>
      <section className="question-stage">
        {!preparing && (
          <MatchTimerRing
            deadlineMs={deadlineMs}
            initialRemainingMs={remainingMs}
            key={`${deadlineMs}:${resolved ? 'resolved' : 'active'}`}
            resolved={resolved}
            verdict={!viewerAnsweredThisRound ? 'none' : viewerCorrect === true ? 'correct' : 'wrong'}
          />
        )}
        {question.imageUrl && <QuestionMedia key={question.imageUrl} url={question.imageUrl} />}
        <h1>{question.prompt}</h1>
        <div className="answer-grid">
          {question.options.map((option, index) => {
            const correct = resolution?.correctOption === index;
            const viewerRevealedHere = resolved && selected === index;
            const opponentRevealedHere = resolved && opponentSelected === index;
            const incorrect = resolved && !correct && (viewerRevealedHere || opponentRevealedHere);
            const className = [
              'answer-option',
              selected === index ? 'answer-option--selected' : '',
              correct ? 'answer-option--correct' : '',
              incorrect ? 'answer-option--incorrect' : '',
              viewerRevealedHere || opponentRevealedHere ? 'answer-option--with-avatars' : '',
              viewerRevealedHere && opponentRevealedHere ? 'answer-option--dual-avatar' : '',
            ].filter(Boolean).join(' ');
            const marker = correct ? '✓' : incorrect ? '×' : OPTION_LABELS[index];
            return (
              <button
                aria-label={`${OPTION_LABELS[index]}: ${option}${correct ? ' — correta' : incorrect ? ' — incorreta' : ''}${viewerRevealedHere ? ' — sua resposta' : ''}${opponentRevealedHere ? ' — resposta do adversário' : ''}`}
                className={className}
                data-option={OPTION_LABELS[index]}
                disabled={answersLocked}
                key={OPTION_LABELS[index]}
                onClick={() => choose(index)}
                type="button"
              >
                <span aria-hidden="true" className="answer-option__marker">{marker}</span>
                <strong>{option}</strong>
                {(viewerRevealedHere || opponentRevealedHere) && (
                  <span className="answer-option__avatars">
                    {viewerRevealedHere && (
                      <span className="answer-option__choice-avatar answer-option__choice-avatar--viewer" data-participant="viewer">
                        <AvatarFrame frameId={player.frameId} variant="choice">
                          <Avatar customUrl={player.customAvatarUrl} googleUrl={player.photoUrl} name={player.name} size="small" />
                        </AvatarFrame>
                      </span>
                    )}
                    {opponentRevealedHere && (
                      <span className="answer-option__choice-avatar answer-option__choice-avatar--opponent" data-participant="opponent">
                        <AvatarFrame frameId={opponent.frameId} variant="choice">
                          <Avatar customUrl={opponent.customAvatarUrl} googleUrl={opponent.photoUrl} name={opponent.name} size="small" />
                        </AvatarFrame>
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
      {preparing
        ? <div aria-hidden="true" className="match-timer match-timer--preparing" />
        : (
          <MatchTimer
            deadlineMs={deadlineMs}
            initialRemainingMs={remainingMs}
            key={`${deadlineMs}:${resolved ? 'resolved' : 'active'}`}
            onExpire={handleExpire}
            resolved={resolved}
          />
        )}
    </main>
  );
}
