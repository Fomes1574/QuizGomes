import { QUESTION_DURATION_MS, displayedSeconds, remainingAt } from '@quiz-gomes/domain';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Avatar } from './avatar.js';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

interface MatchParticipantView {
  frameId?: string | null;
  name: string;
  photoUrl?: string | null;
}

interface MatchTimerStyle extends CSSProperties {
  '--timer-duration': string;
  '--timer-from-ratio': number;
  '--timer-reduced-ratio': number;
}

export interface MatchQuestionView {
  imageUrl?: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

export interface MatchResolutionView {
  correctOption: number;
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
  pausedRemainingMs,
  resolved,
}: {
  deadlineMs: number;
  initialRemainingMs: number;
  onExpire: () => void;
  pausedRemainingMs?: number | undefined;
  resolved: boolean;
}) {
  const fixedRemaining = resolved ? 0 : pausedRemainingMs;
  const animationStartRemaining = normalizedRemaining(fixedRemaining ?? initialRemainingMs);
  const [snapshot, setSnapshot] = useState(() => ({
    remainingMs: animationStartRemaining,
    seconds: displayedSeconds(animationStartRemaining),
  }));

  useEffect(() => {
    let timer: number | null = null;
    let expired = false;
    const update = () => {
      const remainingMs = normalizedRemaining(fixedRemaining ?? remainingAt(Date.now(), deadlineMs));
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
      if (fixedRemaining !== undefined) return;
      const remainder = remainingMs % 1_000;
      const untilNextSecond = remainder === 0 ? 1_000 : remainder;
      timer = window.setTimeout(update, Math.min(1_000, Math.max(16, untilNextSecond)));
    };

    update();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deadlineMs, fixedRemaining, onExpire]);

  const paused = !resolved && fixedRemaining !== undefined;
  const running = !resolved && !paused && animationStartRemaining > 0;
  const style: MatchTimerStyle = {
    '--timer-duration': `${Math.max(1, animationStartRemaining)}ms`,
    '--timer-from-ratio': animationStartRemaining / QUESTION_DURATION_MS,
    '--timer-reduced-ratio': snapshot.remainingMs / QUESTION_DURATION_MS,
  };

  return (
    <div className="match-timer" role="timer" aria-label={`${snapshot.seconds} segundos restantes`}>
      <span
        aria-hidden="true"
        className={`match-timer__bar${running ? ' match-timer__bar--running' : ''}${paused ? ' match-timer__bar--paused' : ''}`}
        key={`${resolved ? 'resolved' : paused ? 'paused' : 'running'}:${deadlineMs}:${fixedRemaining ?? ''}`}
        style={style}
      />
      <strong aria-hidden="true">{snapshot.seconds}</strong>
    </div>
  );
}

function participantFrameClass(frameId: string | null | undefined): string {
  return `match-avatar-frame${frameId === null || frameId === undefined ? '' : ' match-avatar-frame--equipped'}`;
}

export function MatchScreen({
  deadlineMs,
  onAnswer,
  opponent,
  opponentAnswered = false,
  opponentScore,
  paused = false,
  pausedRemainingMs,
  player,
  playerScore,
  question,
  remainingMs,
  resolution,
  round,
  selectedOption,
}: {
  deadlineMs: number;
  onAnswer: (option: number) => void;
  opponent: MatchParticipantView;
  opponentAnswered?: boolean;
  opponentScore: number;
  paused?: boolean;
  pausedRemainingMs?: number | undefined;
  player: MatchParticipantView;
  playerScore: number;
  question: MatchQuestionView;
  remainingMs: number;
  resolution?: MatchResolutionView | undefined;
  round?: { number: number; total: number } | undefined;
  selectedOption?: number | null | undefined;
}) {
  const [localSelected, setLocalSelected] = useState<number | null>(selectedOption ?? resolution?.viewer.selectedOption ?? null);
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const [opponentScoreAtRoundStart] = useState(opponentScore);
  const selected = resolution?.viewer.selectedOption ?? selectedOption ?? localSelected;
  const resolved = resolution !== undefined;
  const visuallyExpired = !paused && (expiredDeadline === deadlineMs || remainingMs <= 0);
  const opponentCorrectOption = resolved && opponentScore > opponentScoreAtRoundStart
    ? resolution.correctOption
    : null;
  const handleExpire = useCallback(() => setExpiredDeadline(deadlineMs), [deadlineMs]);

  return (
    <main className={`match-screen${resolved ? ' match-screen--resolved' : ''}${paused ? ' match-screen--paused' : ''}`}>
      <header className="match-scoreboard">
        <div className="opponent-chip">
          <span
            aria-label={opponentAnswered ? 'Adversário respondeu' : 'Adversário pensando'}
            className={`status-dot ${opponentAnswered ? 'status-dot--answered' : ''}`}
            role="status"
          />
          <span className={participantFrameClass(opponent.frameId)} data-frame-id={opponent.frameId ?? undefined}>
            <Avatar name={opponent.name} photoUrl={opponent.photoUrl} size="small" />
          </span>
          <span className="match-scoreboard__copy">
            <small>{opponent.name}</small>
            <strong aria-live="polite" key={opponentScore}>{opponentScore}</strong>
          </span>
        </div>
        {round !== undefined && <span className="round-counter">PERGUNTA {round.number} / {round.total}</span>}
        <div className="player-chip">
          <span className="match-scoreboard__copy">
            <small>Você</small>
            <strong aria-live="polite" key={playerScore}>{playerScore}</strong>
            {resolved && resolution.viewer.roundScore > 0 && (
              <span aria-label={`${resolution.viewer.roundScore} pontos ganhos`} className="score-gain">
                +{resolution.viewer.roundScore}
              </span>
            )}
          </span>
          <span className={participantFrameClass(player.frameId)} data-frame-id={player.frameId ?? undefined}>
            <Avatar name={player.name} photoUrl={player.photoUrl} size="small" />
          </span>
        </div>
      </header>
      <section className="question-stage">
        {question.imageUrl && <img alt="Imagem da pergunta" className="question-image" src={question.imageUrl} />}
        <h1>{question.prompt}</h1>
        <div className="answer-grid">
          {question.options.map((option, index) => {
            const correct = resolution?.correctOption === index;
            const incorrect = resolved && selected === index && !correct;
            const opponentRevealedHere = opponentCorrectOption === index;
            const className = [
              'answer-option',
              selected === index ? 'answer-option--selected' : '',
              correct ? 'answer-option--correct' : '',
              incorrect ? 'answer-option--incorrect' : '',
            ].filter(Boolean).join(' ');
            const marker = correct ? '✓' : incorrect ? '×' : OPTION_LABELS[index];
            return (
              <button
                aria-label={`${OPTION_LABELS[index]}: ${option}${correct ? ' — correta' : incorrect ? ' — incorreta' : ''}${opponentRevealedHere ? ' — resposta correta do adversário' : ''}`}
                className={className}
                disabled={paused || selected !== null || visuallyExpired || resolved}
                key={OPTION_LABELS[index]}
                onClick={() => { setLocalSelected(index); onAnswer(index); }}
                type="button"
              >
                <span aria-hidden="true" className="answer-option__marker">{marker}</span>
                <strong>{option}</strong>
                {opponentRevealedHere && (
                  <span className="answer-option__opponent">
                    <Avatar name={opponent.name} photoUrl={opponent.photoUrl} size="small" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <MatchTimer
        deadlineMs={deadlineMs}
        initialRemainingMs={remainingMs}
        key={`${deadlineMs}:${paused ? pausedRemainingMs ?? 0 : 'running'}:${resolved ? 'resolved' : 'active'}`}
        onExpire={handleExpire}
        pausedRemainingMs={paused ? (pausedRemainingMs ?? 0) : undefined}
        resolved={resolved}
      />
    </main>
  );
}
