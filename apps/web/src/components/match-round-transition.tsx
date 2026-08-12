import type { CSSProperties } from 'react';

export const MATCH_ROUND_TRANSITION_MS = 1_900;
export const MATCH_QUESTION_ENTRANCE_MS = 300;

interface RoundTransitionStyle extends CSSProperties {
  '--match-question-entrance-duration': string;
  '--round-transition-duration': string;
}

export function roundPresentationDelay(serverDelayMs = 0): number {
  if (!Number.isFinite(serverDelayMs)) return MATCH_ROUND_TRANSITION_MS;
  return Math.max(MATCH_ROUND_TRANSITION_MS, Math.max(0, Math.ceil(serverDelayMs)));
}

export function MatchRoundTransition({
  durationMs = MATCH_ROUND_TRANSITION_MS,
  number,
  total,
}: {
  durationMs?: number;
  number: number;
  total: number;
}) {
  const style: RoundTransitionStyle = {
    '--match-question-entrance-duration': `${MATCH_QUESTION_ENTRANCE_MS}ms`,
    '--round-transition-duration': `${durationMs}ms`,
  };

  return (
    <div
      aria-label={`Pergunta ${number} de ${total}`}
      aria-live="polite"
      className="round-transition-overlay"
      role="status"
      style={style}
    >
      <div className="round-transition">
        <span>PERGUNTA</span>
        <strong><span>{number}</span><small>/ {total}</small></strong>
      </div>
    </div>
  );
}
