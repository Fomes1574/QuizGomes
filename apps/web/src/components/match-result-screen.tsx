import {
  nextDivisionGoal,
  rankChange,
  rankedKnowledgeValues,
  topChangeMessage,
  topTitleTier,
  type MatchResult,
  type MatchThemeRewards,
  type PlayerTitle,
} from '@quiz-gomes/domain';
import { useEffect, useState, type CSSProperties } from 'react';
import { feedback, prefersReducedMotion } from '../lib/feedback.js';
import type { SeenQuestion } from '../lib/reports.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Button } from './button.js';
import { Icon } from './icons.js';
import { Logo } from './logo.js';
import { PlayerTitleText } from './player-title.js';
import { rankTierClass } from './rank-badge.js';
import { RankEmblem } from './rank-emblem.js';
import { RankingRulesDialog } from './ranking-rules-dialog.js';
import { InstallInvite } from './install-invite.js';
import { ShareResultButton } from './share-result-button.js';
import type { RematchInvite } from '../lib/rematch.js';

interface ResultParticipant {
  customAvatarUrl?: string | null;
  frameId?: string | null;
  name: string;
  photoUrl?: string | null;
  result: MatchResult;
  score: number;
  title?: PlayerTitle | null;
}

interface KnowledgeProgressStyle extends CSSProperties {
  '--knowledge-from': number;
  '--knowledge-progress': number;
}

/** Conta de um número até outro (~0,9 s); com movimento reduzido, já mostra o final. */
function useCountUp(from: number, to: number, delayMs = 480, durationMs = 900): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : from));
  useEffect(() => {
    if (from === to || prefersReducedMotion()) return undefined;
    let frame = 0;
    let started: number | null = null;
    const timer = window.setTimeout(() => {
      const step = (now: number) => {
        started ??= now;
        const t = Math.min(1, (now - started) / durationMs);
        const eased = 1 - (1 - t) ** 3;
        setValue(Math.round(from + (to - from) * eased));
        if (t < 1) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    }, delayMs);
    return () => { window.clearTimeout(timer); window.cancelAnimationFrame(frame); };
  }, [delayMs, durationMs, from, to]);
  return value;
}

/**
 * Subiu ou caiu de divisão nesta partida. Subir de liga ganha festa; cair é
 * dito sem drama, com o caminho de volta.
 */
function RankChangeBanner({ knowledgeAfter, knowledgeBefore }: { knowledgeAfter: number; knowledgeBefore: number }) {
  const change = rankChange(knowledgeBefore, knowledgeAfter);
  if (change.kind === 'NONE') return null;
  const { after } = change;
  const label = `${after.tier} ${after.division}`;
  const up = change.kind === 'TIER_UP' || change.kind === 'DIVISION_UP';
  const values = rankedKnowledgeValues(after.tier);
  const back = up ? null : nextDivisionGoal(after.knowledge);
  const copy = change.kind === 'TIER_UP'
    ? { eyebrow: 'Nova liga!', text: `Daqui pra frente, vitória vale +${values.win} e derrota −${values.loss}.`, title: `Você chegou a ${label}` }
    : change.kind === 'DIVISION_UP'
      ? { eyebrow: 'Subiu de divisão', text: 'Continua assim que a próxima já está à vista.', title: label }
      : {
        eyebrow: 'Mudou de divisão',
        text: back === null ? ''
          : back.missing <= values.win ? 'Uma vitória já te leva de volta.'
            : `Faltam ${back.missing.toLocaleString('pt-BR')} de Conhecimento para voltar.`,
        title: `Sua divisão agora é ${label}`,
      };
  return (
    <div
      className={`rank-change rank-change--${up ? 'up' : 'down'}${change.kind === 'TIER_UP' ? ' rank-change--tier' : ''} rank-badge--${rankTierClass(after.tier)}`}
      role="status"
    >
      <span className="rank-change__emblem"><RankEmblem tier={after.tier} /></span>
      <span className="rank-change__copy">
        <small>{copy.eyebrow}</small>
        <strong>{copy.title}</strong>
        {copy.text !== '' && <span>{copy.text}</span>}
      </span>
    </div>
  );
}

/**
 * O que a Rankeada mudou fora do placar: Top do tema e títulos novos. Chega
 * um instante depois do resultado, então entra sem empurrar o resto.
 */
function ThemeRewardsPanel({ rewards }: { rewards: MatchThemeRewards }) {
  const topMessage = topChangeMessage(rewards.top, rewards.themeName);
  if (topMessage === null && rewards.achievements.length === 0) return null;
  const topStyle = rewards.top.after === null ? null : topTitleTier(rewards.top.after);
  return (
    <section aria-live="polite" className="match-rewards">
      {topMessage !== null && (
        <p className={`match-rewards__top${topStyle === null ? ' match-rewards__top--out' : ` match-rewards__top--${topStyle}`}`}>
          {topStyle === null
            ? topMessage
            : <PlayerTitleText animated title={{ label: topMessage, style: topStyle }} />}
        </p>
      )}
      {rewards.achievements.length > 0 && (
        <div className="match-rewards__titles">
          <small>{rewards.achievements.length === 1 ? 'Título novo' : 'Títulos novos'}</small>
          <ul>
            {rewards.achievements.map((achievement) => (
              <li key={achievement.id}>{achievement.title}</li>
            ))}
          </ul>
          <span>Dá pra usar no Perfil, em Títulos.</span>
        </div>
      )}
    </section>
  );
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

/** Confete da vitória; ao subir de liga, nas cores da liga nova. */
function Confetti({ tierClass }: { tierClass?: string | undefined }) {
  return (
    <span aria-hidden="true" className={`confetti${tierClass === undefined ? '' : ` confetti--tier rank-badge--${tierClass}`}`}>
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
      <PlayerTitleText compact title={participant.title} />
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
  rematch,
  shareUrl,
  themeName,
  themeRewards,
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
  /** Revanche imediata contra o mesmo adversário (fila privada de 30 s). */
  rematch?: {
    incoming: RematchInvite | null;
    message?: string;
    onAccept: (invite: RematchInvite) => void;
    onRequest: () => void;
    state: 'error' | 'idle' | 'sending';
  } | undefined;
  /** Link do tema que acompanha o cartão compartilhado (abre a prévia do tema). */
  shareUrl?: string | undefined;
  /** Nome do tema, só para a carta de story (texto de exibição). */
  themeName?: string | null | undefined;
  /** Conquistas e Top do tema desta Rankeada (chega logo depois do resultado). */
  themeRewards?: MatchThemeRewards | null | undefined;
  viewer: ResultParticipant;
  voidReason?: string | undefined;
  xpDelta: number;
}) {
  const knowledgeBefore = Math.max(0, knowledgeAfter - knowledgeDelta);
  const change = rankChange(knowledgeBefore, knowledgeAfter);
  const rank = change.after;
  const knowledgeStyle: KnowledgeProgressStyle = {
    '--knowledge-from': change.kind === 'NONE' ? change.before.progress : change.kind.endsWith('UP') ? 0 : 1,
    '--knowledge-progress': rank.progress,
  };
  const shownKnowledge = useCountUp(knowledgeBefore, knowledgeAfter);
  const goal = nextDivisionGoal(knowledgeAfter);
  const [rulesOpen, setRulesOpen] = useState(false);
  const resultClass = viewer.result.toLocaleLowerCase();
  const cancelledBeforeStart = viewer.result === 'VOID' && voidReason === 'CANCELLED';
  const tagline = cancelledBeforeStart ? null : resultTagline(viewer, opponent);
  const won = viewer.result === 'WIN';
  const showConfetti = won && !prefersReducedMotion();
  const rankedResult = ranked !== false && viewer.result !== 'VOID';

  useEffect(() => {
    if (won) feedback('win');
  }, [won]);

  return (
    <main className={`match-result-screen match-result-screen--${resultClass}`}>
      {showConfetti && <Confetti tierClass={rankedResult && change.kind === 'TIER_UP' ? rankTierClass(rank.tier) : undefined} />}
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
      {rankedResult && !cancelledBeforeStart && <RankChangeBanner knowledgeAfter={knowledgeAfter} knowledgeBefore={knowledgeBefore} />}
      {themeRewards != null && !cancelledBeforeStart && <ThemeRewardsPanel rewards={themeRewards} />}
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
              <strong aria-label={String(knowledgeAfter)}>{shownKnowledge.toLocaleString('pt-BR')}</strong>
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
              <span className="match-result-progress__goal">
                {goal === null ? 'Topo do ranking' : `Faltam ${goal.missing.toLocaleString('pt-BR')} para ${goal.target.tier} ${goal.target.division}`}
              </span>
            </article>
            </>
            )}
          </section>
        )}
      {rankedResult && !cancelledBeforeStart && ranked === true && (
        <button className="ranking-rules-link" onClick={() => setRulesOpen(true)} type="button">Como funciona o ranking?</button>
      )}
      {rulesOpen && <RankingRulesDialog onClose={() => setRulesOpen(false)} />}
      {onReport !== undefined && questions !== undefined && questions.length > 0 && (
        <section aria-label="Perguntas desta partida" className="match-result-questions">
          <h2>Perguntas desta partida</h2>
          <p>Veja o que era certo. Achou alguma pergunta errada? Toque na bandeira.</p>
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
      {rematch?.incoming != null && !cancelledBeforeStart && (
        <div className="rematch-invite" role="status">
          <span aria-hidden="true" className="rematch-invite__icon"><Icon name="bolt" /></span>
          <p><strong>{rematch.incoming.fromName}</strong> quer revanche!</p>
          <Button className="rematch-invite__accept" onClick={() => { if (rematch.incoming !== null) rematch.onAccept(rematch.incoming); }}>Aceitar revanche</Button>
        </div>
      )}
      <div className="match-result-actions">
        {rematch !== undefined && rematch.incoming === null && !cancelledBeforeStart && (
          <Button className="match-result-actions__rematch" disabled={rematch.state === 'sending'} onClick={rematch.onRequest}>
            <Icon name="bolt" />{rematch.state === 'sending' ? 'Chamando…' : `Revanche com ${opponent.name.split(' ')[0] ?? 'adversário'}`}
          </Button>
        )}
        {rematch !== undefined && rematch.incoming === null && !cancelledBeforeStart && ranked === true && (
          <p className="match-result-actions__note">A revanche é na Normal. Rankeada, só na fila.</p>
        )}
        {rematch?.state === 'error' && rematch.message !== undefined && <p className="form-error">{rematch.message}</p>}
        {onPlayAgain !== undefined && !cancelledBeforeStart && (
          <Button className="match-result-actions__again" onClick={onPlayAgain} variant={rematch === undefined ? 'primary' : 'secondary'}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.3-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>Jogar de novo</Button>
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
            opponent: { avatarUrl: opponent.customAvatarUrl ?? opponent.photoUrl ?? null, name: opponent.name, score: opponent.score },
            personalRecord,
            ranked: ranked === true,
            result: viewer.result,
            themeName: themeName ?? null,
            viewer: { avatarUrl: viewer.customAvatarUrl ?? viewer.photoUrl ?? null, name: viewer.name, score: viewer.score },
          }} url={shareUrl} />
        )}
        {viewer.result === 'WIN' && <InstallInvite />}
        <Button onClick={onBack} variant={onPlayAgain !== undefined && !cancelledBeforeStart ? 'ghost' : 'primary'}>{cancelledBeforeStart ? 'Voltar ao tema' : 'Voltar aos temas'}</Button>
      </div>
    </main>
  );
}
