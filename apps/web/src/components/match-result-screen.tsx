import { rankForKnowledge, type MatchResult } from '@quiz-gomes/domain';
import type { CSSProperties } from 'react';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';
import { Logo } from './logo.js';

interface ResultParticipant {
  customAvatarUrl?: string | null;
  frameId?: string | null;
  name: string;
  photoUrl?: string | null;
  result: MatchResult;
  score: number;
}

interface KnowledgeProgressStyle extends CSSProperties {
  '--knowledge-progress': number;
}

const RESULT_LABELS: Record<MatchResult, string> = {
  DRAW: 'Empate',
  LOSS: 'Derrota',
  VOID: 'Partida anulada',
  WIN: 'Vitória',
};

const VOID_LABELS: Record<string, string> = {
  CANCELLED: 'A partida foi cancelada antes do início.',
  INDIVIDUAL_ABANDONMENT: 'A partida foi anulada por abandono.',
  INDIVIDUAL_DISCONNECT: 'A partida foi anulada por perda de conexão.',
  READINESS_TIMEOUT: 'Um jogador não ficou pronto dentro do prazo.',
  SYSTEM_FAILURE: 'A partida foi anulada sem penalidade por falha da sala.',
};

function resultParticipantClass(participant: ResultParticipant): string {
  return `match-result-player${participant.result === 'WIN' ? ' match-result-player--winner' : ''}`;
}

function ResultPlayer({ participant, relation }: {
  participant: ResultParticipant;
  relation: 'Adversário' | 'Você';
}) {
  return (
    <article className={resultParticipantClass(participant)}>
      <div className="match-result-portrait">
        <AvatarFrame frameId={participant.frameId} variant="result">
          <Avatar customUrl={participant.customAvatarUrl} googleUrl={participant.photoUrl} name={participant.name} size="large" />
        </AvatarFrame>
      </div>
      <small>{relation}</small>
      <strong className="match-result-player__name">{participant.name}</strong>
      <strong className="match-result-player__score">{participant.score}<small>pontos</small></strong>
    </article>
  );
}

export function MatchResultScreen({
  cancelledBy,
  knowledgeAfter,
  knowledgeDelta,
  onBack,
  opponent,
  viewer,
  voidReason,
  xpDelta,
}: {
  cancelledBy?: { displayName: string; seat: number } | undefined;
  knowledgeAfter: number;
  knowledgeDelta: number;
  onBack: () => void;
  opponent: ResultParticipant;
  viewer: ResultParticipant;
  voidReason?: string | undefined;
  xpDelta: number;
}) {
  const rank = rankForKnowledge(knowledgeAfter);
  const knowledgeStyle: KnowledgeProgressStyle = { '--knowledge-progress': rank.progress };
  const resultClass = viewer.result.toLocaleLowerCase();
  const cancelledBeforeStart = viewer.result === 'VOID' && voidReason === 'CANCELLED';

  return (
    <main className={`match-result-screen match-result-screen--${resultClass}`}>
      <Logo />
      <header className="match-result-heading">
        <span>{cancelledBeforeStart ? 'AVISO' : 'RESULTADO'}</span>
        <h1>{cancelledBeforeStart ? 'Partida cancelada' : RESULT_LABELS[viewer.result]}</h1>
      </header>
      {!cancelledBeforeStart && (
        <section aria-label="Placar final" className="match-result-duel">
          <ResultPlayer participant={viewer} relation="Você" />
          <span aria-hidden="true" className="match-result-versus">×</span>
          <ResultPlayer participant={opponent} relation="Adversário" />
        </section>
      )}
      {viewer.result === 'VOID'
        ? <p>{cancelledBeforeStart && cancelledBy !== undefined
          ? `Partida cancelada por ${cancelledBy.displayName}`
          : VOID_LABELS[voidReason ?? 'SYSTEM_FAILURE'] ?? 'A partida foi anulada.'}</p>
        : (
          <section aria-label="Progressão da partida" className="match-result-progress">
            <article>
              <small>XP ganho</small>
              <strong>+{xpDelta}</strong>
              <span aria-hidden="true" className="match-result-progress__reveal" />
            </article>
            <article>
              <small>Conhecimento</small>
              <strong>{knowledgeDelta >= 0 ? '+' : ''}{knowledgeDelta}</strong>
              <span aria-hidden="true" className="match-result-progress__reveal" />
            </article>
            <article>
              <small>Total no tema</small>
              <strong>{knowledgeAfter}</strong>
              <span>{rank.tier} {rank.division}</span>
              <span
                aria-label={`${Math.round(rank.progress * 100)}% da divisão atual`}
                className="match-result-progress__track"
                role="progressbar"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(rank.progress * 100)}
              >
                <span aria-hidden="true" style={knowledgeStyle} />
              </span>
            </article>
          </section>
        )}
      <div className="match-result-actions">
        <Button onClick={onBack}>{cancelledBeforeStart ? 'Voltar ao tema' : 'Voltar aos temas'}</Button>
      </div>
    </main>
  );
}
