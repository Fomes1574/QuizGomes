import { displayedSeconds, remainingAt } from '@quiz-gomes/domain';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './avatar.js';

export interface MatchQuestionView {
  imageUrl?: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

export function MatchScreen({
  deadlineMs,
  onAnswer,
  opponent,
  opponentAnswered = false,
  opponentScore,
  playerScore,
  question,
}: {
  deadlineMs: number;
  onAnswer: (option: number) => void;
  opponent: { name: string; photoUrl?: string | null };
  opponentAnswered?: boolean;
  opponentScore: number;
  playerScore: number;
  question: MatchQuestionView;
}) {
  const [now, setNow] = useState(deadlineMs - 10_000);
  const [selected, setSelected] = useState<number | null>(null);
  const remaining = remainingAt(now, deadlineMs);
  const seconds = displayedSeconds(remaining);
  const ratio = Math.max(0, Math.min(1, remaining / 10_000));

  useEffect(() => {
    if (selected !== null || remaining <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [remaining, selected]);

  const labels = useMemo(() => ['A', 'B', 'C', 'D'] as const, []);

  return (
    <main className="match-screen">
      <header className="match-scoreboard">
        <div className="opponent-chip"><span className={`status-dot ${opponentAnswered ? 'status-dot--answered' : ''}`} /><Avatar name={opponent.name} photoUrl={opponent.photoUrl} size="small" /><span><small>{opponent.name}</small><strong>{opponentScore}</strong></span></div>
        <div className="player-score"><small>Você</small><strong>{playerScore}</strong></div>
      </header>
      <section className="question-stage">
        {question.imageUrl && <img alt="Imagem da pergunta" className="question-image" src={question.imageUrl} />}
        <h1>{question.prompt}</h1>
        <div className="answer-grid">
          {question.options.map((option, index) => (
            <button className={`answer-option${selected === index ? ' answer-option--selected' : ''}`} disabled={selected !== null || remaining <= 0} key={labels[index]} onClick={() => { setSelected(index); onAnswer(index); }} type="button"><span>{labels[index]}</span><strong>{option}</strong></button>
          ))}
        </div>
      </section>
      <div className="match-timer" role="timer" aria-label={`${seconds} segundos restantes`}><span className="match-timer__bar" style={{ transform: `scaleX(${ratio})` }} /><strong>{seconds}</strong></div>
    </main>
  );
}
