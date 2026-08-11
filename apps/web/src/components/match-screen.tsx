import { displayedSeconds, remainingAt } from '@quiz-gomes/domain';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './avatar.js';

export interface MatchQuestionView {
  imageUrl?: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

export interface MatchResolutionView {
  correctOption: number;
  viewer: {
    correct: boolean;
    selectedOption: number | null;
  };
}

export function MatchScreen({
  deadlineMs,
  onAnswer,
  opponent,
  opponentAnswered = false,
  opponentScore,
  playerScore,
  question,
  resolution,
  round,
  selectedOption,
}: {
  deadlineMs: number;
  onAnswer: (option: number) => void;
  opponent: { name: string; photoUrl?: string | null };
  opponentAnswered?: boolean;
  opponentScore: number;
  playerScore: number;
  question: MatchQuestionView;
  resolution?: MatchResolutionView | undefined;
  round?: { number: number; total: number } | undefined;
  selectedOption?: number | null | undefined;
}) {
  const [now, setNow] = useState(deadlineMs - 10_000);
  const [localSelected, setLocalSelected] = useState<number | null>(selectedOption ?? resolution?.viewer.selectedOption ?? null);
  const selected = resolution?.viewer.selectedOption ?? selectedOption ?? localSelected;
  const remaining = resolution === undefined ? remainingAt(now, deadlineMs) : 0;
  const seconds = displayedSeconds(remaining);
  const ratio = Math.max(0, Math.min(1, remaining / 10_000));

  useEffect(() => {
    if (resolution !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [deadlineMs, resolution]);

  const labels = useMemo(() => ['A', 'B', 'C', 'D'] as const, []);

  return (
    <main className="match-screen">
      <header className="match-scoreboard">
        <div className="opponent-chip">
          <span aria-label={opponentAnswered ? 'Adversário respondeu' : 'Adversário pensando'} className={`status-dot ${opponentAnswered ? 'status-dot--answered' : ''}`} role="status" />
          <Avatar name={opponent.name} photoUrl={opponent.photoUrl} size="small" />
          <span><small>{opponent.name}</small><strong>{opponentScore}</strong></span>
        </div>
        {round !== undefined && <span className="round-counter">PERGUNTA {round.number} / {round.total}</span>}
        <div className="player-score"><small>Você</small><strong>{playerScore}</strong></div>
      </header>
      <section className="question-stage">
        {question.imageUrl && <img alt="Imagem da pergunta" className="question-image" src={question.imageUrl} />}
        <h1>{question.prompt}</h1>
        <div className="answer-grid">
          {question.options.map((option, index) => {
            const correct = resolution?.correctOption === index;
            const incorrect = resolution !== undefined && selected === index && !correct;
            const className = [
              'answer-option',
              selected === index ? 'answer-option--selected' : '',
              correct ? 'answer-option--correct' : '',
              incorrect ? 'answer-option--incorrect' : '',
            ].filter(Boolean).join(' ');
            const marker = correct ? '✓' : incorrect ? '×' : labels[index];
            return (
              <button
                aria-label={`${labels[index]}: ${option}${correct ? ' — correta' : incorrect ? ' — incorreta' : ''}`}
                className={className}
                disabled={selected !== null || remaining <= 0 || resolution !== undefined}
                key={labels[index]}
                onClick={() => { setLocalSelected(index); onAnswer(index); }}
                type="button"
              >
                <span aria-hidden="true">{marker}</span><strong>{option}</strong>
              </button>
            );
          })}
        </div>
      </section>
      <div className="match-timer" role="timer" aria-label={`${seconds} segundos restantes`}>
        <span className="match-timer__bar" style={{ transform: `scaleX(${ratio})` }} /><strong>{seconds}</strong>
      </div>
    </main>
  );
}
