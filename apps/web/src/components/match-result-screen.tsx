import { rankForKnowledge, type MatchResult } from '@quiz-gomes/domain';
import { useEffect, type CSSProperties } from 'react';
import { feedback, prefersReducedMotion } from '../lib/feedback.js';
import type { SeenQuestion } from '../lib/reports.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';
import { Icon } from './icons.js';
import { Logo } from './logo.js';
import { InstallInvite } from './install-invite.js';
import { ShareResultButton } from './share-result-button.js';

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

/** Frase curta com personalidade; nunca afirma nada que o placar não mostre. */
function resultTagline(viewer: ResultParticipant, opponent: ResultParticipant): string | null {
  if (viewer.result === 'WIN') {
    return viewer.score >= opponent.score * 2 ? 'Atropelou geral.' : 'Mandou bem demais.';
  }
  if (viewer.result === 'DRAW') return 'Empate. Ninguém cedeu um ponto.';
  if (viewer.result === 'LOSS') {
    const margin = opponent.score === 0 ? 1 : (opponent.score - viewer.score) / opponent.score;
    return margin <= 0.15 ? 'Por um triz. Foi no detalhe.' : 'Dá pra virar essa na próxima.';
  }
  return null;
}

const CONFETTI_PIECES = 26;

function Confetti() {
  return (
    <span aria-hidden="true" className="confetti">
      {Array.from({ length: CONFETTI_PIECES }, (_, index) => (
        <i
          key={index}
          style={{
            '--confetti-delay': `${(index % 9) * 70}ms`,
            '--confetti-drift': `${((index * 37) % 120) - 60}px`,
            '--confetti-spin': `${((index * 53) % 540) + 180}deg`,
            '--confetti-x': `${(index * 97) % 100}%`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}

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
        {participant.result === 'WIN' && <span aria-hidden="true" className="match-result-crown">
          <svg viewBox="0 0 24 24"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z" /></svg>
        </span>}
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

export type OpponentFriendStatus = 'error' | 'friend' | 'idle' | 'sending' | 'sent';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export function MatchResultScreen({
  addFriend,
  cancelledBy,
  knowledgeAfter,
  knowledgeDelta,
  onBack,
  onPlayAgain,
  onReport,
  opponent,
  personalRecord = false,
  questions,
  ranked,
  themeName,
  viewer,
  voidReason,
  xpDelta,
}: {
  /** Pedido de amizade ao adversário desta partida; ausente em desafio entre amigos. */
  addFriend?: { message?: string | undefined; onClick: () => void; status: OpponentFriendStatus } | undefined;
  cancelledBy?: { displayName: string; seat: number } | undefined;
  knowledgeAfter: number;
  knowledgeDelta: number;
  onBack: () => void;
  /** Volta para a mesma fila (mesmo tema e modo) com um toque. */
  onPlayAgain?: (() => void) | undefined;
  /** Ausente quando não há como denunciar (tela reaberta sem o histórico local da sessão). */
  onReport?: ((question: SeenQuestion) => void) | undefined;
  opponent: ResultParticipant;
  questions?: readonly SeenQuestion[] | undefined;
  /** Esta partida estabeleceu o novo recorde pessoal do jogador no tema e modo. */
  personalRecord?: boolean;
  /** Normal nunca altera Conhecimento; indefinido mantém os três indicadores. */
  ranked?: boolean | undefined;
  /** Nome do tema, só para a carta de story (texto de exibição). */
  themeName?: string | null | undefined;
  viewer: ResultParticipant;
  voidReason?: string | undefined;
  xpDelta: number;
}) {
  const rank = rankForKnowledge(knowledgeAfter);
  const knowledgeStyle: KnowledgeProgressStyle = { '--knowledge-progress': rank.progress };
  const resultClass = viewer.result.toLocaleLowerCase();
  const cancelledBeforeStart = viewer.result === 'VOID' && voidReason === 'CANCELLED';
  const tagline = cancelledBeforeStart ? null : resultTagline(viewer, opponent);
  const won = viewer.result === 'WIN';
  const showConfetti = won && !prefersReducedMotion();

  useEffect(() => {
    if (won) feedback('win');
  }, [won]);

  return (
    <main className={`match-result-screen match-result-screen--${resultClass}`}>
      {showConfetti && <Confetti />}
      <Logo />
      <header className="match-result-heading">
        <span>{cancelledBeforeStart ? 'Aviso' : 'Resultado'}</span>
        <h1>{cancelledBeforeStart ? 'Partida cancelada' : RESULT_LABELS[viewer.result]}</h1>
        {tagline !== null && <p className="match-result-tagline">{tagline}</p>}
        {personalRecord && !cancelledBeforeStart && (
          <span className="record-badge" role="status">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z" /></svg>
            Novo recorde pessoal neste tema!
          </span>
        )}
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
            {ranked === false ? (
              <article className="match-result-progress__note">
                <small>Partida normal</small>
                <strong>Conhecimento intacto</strong>
                <span>Só a Rankeada mexe no ranking do tema.</span>
              </article>
            ) : (
            <>
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
            </>
            )}
          </section>
        )}
      {onReport !== undefined && questions !== undefined && questions.length > 0 && (
        <section aria-label="Perguntas desta partida" className="match-result-questions">
          <h2>Perguntas desta partida</h2>
          <p>Confira o que era certo. Viu algo errado? Reporte agora, enquanto está fresco na memória.</p>
          <ul>
            {questions.map((question) => (
              <li className={question.outcome === undefined ? '' : question.outcome.selectedOption === question.outcome.correctOption ? 'review--right' : 'review--wrong'} key={question.roundNumber}>
                <div className="review__copy">
                  <span className="review__prompt"><b>{question.roundNumber}.</b> {question.prompt}</span>
                  {question.outcome !== undefined && (
                    <span className="review__answers">
                      <span className="review__correct">✓ {OPTION_LETTERS[question.outcome.correctOption]} · {question.outcome.options[question.outcome.correctOption]}</span>
                      {question.outcome.selectedOption === null
                        ? <span className="review__mine">Você não respondeu</span>
                        : question.outcome.selectedOption !== question.outcome.correctOption
                          ? <span className="review__mine">× Você: {OPTION_LETTERS[question.outcome.selectedOption]} · {question.outcome.options[question.outcome.selectedOption]}</span>
                          : null}
                    </span>
                  )}
                </div>
                <button
                  aria-label={`Reportar a pergunta da rodada ${question.roundNumber}`}
                  onClick={() => onReport(question)}
                  type="button"
                ><Icon name="flag" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="match-result-actions">
        {onPlayAgain !== undefined && !cancelledBeforeStart && (
          <Button className="match-result-actions__again" onClick={onPlayAgain}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.3-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>Jogar de novo</Button>
        )}
        {addFriend !== undefined && addFriend.status !== 'friend' && !cancelledBeforeStart && (
          <Button
            disabled={addFriend.status === 'sending' || addFriend.status === 'sent'}
            onClick={addFriend.onClick}
            variant="secondary"
          >
            {addFriend.status === 'sent' ? '✓ Pedido enviado' : addFriend.status === 'sending' ? 'Enviando…' : `Adicionar ${opponent.name.split(' ')[0] ?? 'adversário'}`}
          </Button>
        )}
        {addFriend?.status === 'error' && addFriend.message !== undefined && <p className="form-error">{addFriend.message}</p>}
        {!cancelledBeforeStart && viewer.result !== 'VOID' && (
          <ShareResultButton input={{
            opponent: { name: opponent.name, score: opponent.score },
            personalRecord,
            ranked: ranked === true,
            result: viewer.result,
            themeName: themeName ?? null,
            viewer: { name: viewer.name, score: viewer.score },
          }} />
        )}
        {viewer.result === 'WIN' && <InstallInvite />}
        <Button onClick={onBack} variant={onPlayAgain !== undefined && !cancelledBeforeStart ? 'ghost' : 'primary'}>{cancelledBeforeStart ? 'Voltar ao tema' : 'Voltar aos temas'}</Button>
      </div>
    </main>
  );
}
