import { rankForKnowledge, type MatchResult } from '@quiz-gomes/domain';
import type { CSSProperties } from 'react';
import { Avatar } from './avatar.js';
import { Button } from './button.js';
import { Logo } from './logo.js';

interface ResultParticipant {
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
      <div
        className={`match-result-portrait${participant.frameId === null || participant.frameId === undefined ? '' : ' match-result-portrait--framed'}`}
        data-frame-id={participant.frameId ?? undefined}
      >
        <Avatar name={participant.name} photoUrl={participant.photoUrl} size="large" />
      </div>
      <small>{relation}</small>
      <strong className="match-result-player__name">{participant.name}</strong>
      <strong className="match-result-player__score">{participant.score}<small>pontos</small></strong>
    </article>
  );
}

export function MatchResultScreen({
  knowledgeAfter,
  knowledgeDelta,
  onBack,
  opponent,
  viewer,
  voidReason,
  xpDelta,
}: {
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

  return (
    <main className={`match-result-screen match-result-screen--${resultClass}`}>
      <Logo />
      <header className="match-result-heading">
        <span>RESULTADO</span>
        <h1>{RESULT_LABELS[viewer.result]}</h1>
      </header>
      <section aria-label="Placar final" className="match-result-duel">
        <ResultPlayer participant={viewer} relation="Você" />
        <span aria-hidden="true" className="match-result-versus">×</span>
        <ResultPlayer participant={opponent} relation="Adversário" />
      </section>
      {viewer.result === 'VOID'
        ? <p>{VOID_LABELS[voidReason ?? 'SYSTEM_FAILURE'] ?? 'A partida foi anulada.'}</p>
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
        <Button onClick={onBack}>Voltar aos temas</Button>
      </div>
    </main>
  );
}
