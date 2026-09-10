import type { Difficulty } from '../types.js';

/**
 * Regras de desafio entre amigos, unificando o desafio simultâneo (DIRECT) e o
 * desafio assíncrono (ASYNC).
 *
 * Este módulo é puro: decide transições, precedências e visibilidade a partir do
 * estado autoritativo persistido. Quem aplica o resultado é o Worker, sempre com
 * o índice único da dupla como barreira final.
 */

export const DIRECT_CHALLENGE_TIMEOUT_MS = 30_000;

/** Todo desafio entre amigos é Casual: nunca altera Conhecimento. */
export const CHALLENGE_MODE = 'CASUAL' as const;

export type ChallengeKind = 'ASYNC' | 'DIRECT';

export type ChallengeStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FIRST_PLAYER_ACTIVE'
  | 'PENDING_DIRECT'
  | 'PREPARING'
  | 'SECOND_PLAYER_ACTIVE'
  | 'VOID'
  | 'WAITING_FOR_SECOND';

/** Estados que ocupam a dupla: no máximo um desafio nestes estados por A↔B. */
export const LIVE_CHALLENGE_STATUSES: readonly ChallengeStatus[] = [
  'PENDING_DIRECT',
  'PREPARING',
  'ACTIVE',
  'FIRST_PLAYER_ACTIVE',
  'WAITING_FOR_SECOND',
  'SECOND_PLAYER_ACTIVE',
];

/** Estados terminais: liberam a dupla e nunca voltam atrás. */
export const TERMINAL_CHALLENGE_STATUSES: readonly ChallengeStatus[] = [
  'CANCELLED',
  'DECLINED',
  'EXPIRED',
  'VOID',
  'COMPLETED',
];

/**
 * Presenças em que o amigo pode receber um desafio imediato. Espelha exatamente os
 * estados públicos do M9B, sem inventar estado novo.
 */
export type FriendPresence = 'IN_MATCH' | 'MATCHMAKING' | 'OFFLINE' | 'ONLINE' | 'RECONNECTING';

export interface ChallengeRecord {
  difficulty: Difficulty;
  expiresAtMs: number | null;
  firstPlayerUserId: string;
  id: string;
  kind: ChallengeKind;
  /** Revisão autoritativa; toda transição exige a revisão lida (CAS). */
  revision: number;
  secondPlayerAgreed: boolean;
  secondPlayerUserId: string;
  status: ChallengeStatus;
  themeId: string;
}

export class ChallengeRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ChallengeRuleError';
  }
}

export function isLiveChallenge(status: ChallengeStatus): boolean {
  return LIVE_CHALLENGE_STATUSES.includes(status);
}

export function isTerminalChallenge(status: ChallengeStatus): boolean {
  return TERMINAL_CHALLENGE_STATUSES.includes(status);
}

/** Par não ordenado normalizado, base do bloqueio por dupla. */
export function challengePair(first: string, second: string): [string, string] {
  if (first === second) throw new ChallengeRuleError('SAME_USER', 'Um desafio exige dois usuários diferentes.');
  return first < second ? [first, second] : [second, first];
}

/** "Desafiar agora" exige o amigo realmente disponível; o resto aceita qualquer presença. */
export function presenceAllowsDirectChallenge(presence: FriendPresence): boolean {
  return presence === 'ONLINE';
}

export function availableChallengeKinds(presence: FriendPresence): readonly ChallengeKind[] {
  return presenceAllowsDirectChallenge(presence) ? ['DIRECT', 'ASYNC'] : ['ASYNC'];
}

export function directChallengeExpiresAt(createdAtMs: number): number {
  if (!Number.isFinite(createdAtMs) || createdAtMs < 0) throw new RangeError('Instante inválido.');
  return createdAtMs + DIRECT_CHALLENGE_TIMEOUT_MS;
}

export function directChallengeExpired(challenge: ChallengeRecord, nowMs: number): boolean {
  return challenge.kind === 'DIRECT'
    && challenge.status === 'PENDING_DIRECT'
    && challenge.expiresAtMs !== null
    && nowMs >= challenge.expiresAtMs;
}

export type ChallengeCreationDecision =
  | { challengeId: string; kind: 'AGREE_WITH_EXISTING' }
  | { kind: 'CREATE' }
  | { challengeId: string; kind: 'ACCEPT_EXISTING_DIRECT' };

/**
 * Resolve o que fazer quando `requesterUserId` pede um novo desafio contra
 * `targetUserId` e a dupla já pode ter um desafio ativo.
 *
 * Desafio cruzado nunca cria um segundo registro:
 * - se o pedido cruzado bate num convite direto pendente do outro lado, isso é
 *   aceite do convite existente;
 * - se bate num assíncrono já reservado, isso é concordância, e o primeiro
 *   jogador continua sendo quem reservou primeiro.
 */
export function decideChallengeCreation(input: {
  existing: ChallengeRecord | null;
  nowMs: number;
  requestedKind: ChallengeKind;
  requesterUserId: string;
}): ChallengeCreationDecision {
  const { existing, nowMs, requestedKind, requesterUserId } = input;
  if (existing === null || isTerminalChallenge(existing.status)) return { kind: 'CREATE' };
  if (directChallengeExpired(existing, nowMs)) return { kind: 'CREATE' };

  const requesterIsFirst = existing.firstPlayerUserId === requesterUserId;
  if (requesterIsFirst) {
    throw new ChallengeRuleError(
      'CHALLENGE_ALREADY_ACTIVE',
      'Você já tem um desafio em andamento com esta pessoa.',
    );
  }

  if (existing.kind === 'DIRECT' && existing.status === 'PENDING_DIRECT') {
    return { challengeId: existing.id, kind: 'ACCEPT_EXISTING_DIRECT' };
  }
  if (existing.kind === 'ASYNC' && (existing.status === 'FIRST_PLAYER_ACTIVE' || existing.status === 'WAITING_FOR_SECOND')) {
    void requestedKind;
    return { challengeId: existing.id, kind: 'AGREE_WITH_EXISTING' };
  }
  throw new ChallengeRuleError(
    'CHALLENGE_ALREADY_ACTIVE',
    'Já existe um desafio em andamento com esta pessoa.',
  );
}

export type ChallengeAction =
  | { actorUserId: string; type: 'ACCEPT' }
  | { actorUserId: string; type: 'CANCEL' }
  | { actorUserId: string; type: 'DECLINE' }
  | { type: 'EXPIRE' }
  | { type: 'RELATIONSHIP_ENDED' };

export interface ChallengeTransition {
  /** Apaga o conjunto sorteado e as respostas seladas: nenhum resultado é gerado. */
  cleanupPayload: boolean;
  status: ChallengeStatus;
}

function assertActor(challenge: ChallengeRecord, actorUserId: string): void {
  if (actorUserId !== challenge.firstPlayerUserId && actorUserId !== challenge.secondPlayerUserId) {
    throw new ChallengeRuleError('NOT_A_PARTICIPANT', 'Este desafio não pertence a você.');
  }
}

/**
 * O segundo jogador começou a jogar? A partir daí cancelamento e recusa deixam de
 * ser permitidos, e o cancelamento perde a precedência.
 */
export function secondPlayerStarted(status: ChallengeStatus): boolean {
  return status === 'SECOND_PLAYER_ACTIVE' || status === 'ACTIVE' || status === 'COMPLETED';
}

/**
 * Transição autoritativa e determinística de cancelamento, recusa, expiração e fim
 * de relacionamento. O cancelamento tem precedência enquanto o início definitivo do
 * segundo jogador ainda não foi consumado.
 */
export function transitionChallenge(
  challenge: ChallengeRecord,
  action: ChallengeAction,
  nowMs: number,
): ChallengeTransition {
  if (isTerminalChallenge(challenge.status)) {
    throw new ChallengeRuleError('CHALLENGE_NOT_ACTIVE', 'Este desafio já foi encerrado.');
  }

  if (action.type === 'EXPIRE') {
    if (!directChallengeExpired(challenge, nowMs)) {
      throw new ChallengeRuleError('CHALLENGE_NOT_EXPIRED', 'Este convite ainda está válido.');
    }
    return { cleanupPayload: true, status: 'EXPIRED' };
  }

  if (action.type === 'RELATIONSHIP_ENDED') {
    // Partida já iniciada nunca é cancelada por desfazer amizade ou bloqueio.
    if (secondPlayerStarted(challenge.status) || challenge.status === 'PREPARING') {
      throw new ChallengeRuleError('CHALLENGE_ALREADY_STARTED', 'A partida já começou.');
    }
    return { cleanupPayload: true, status: 'CANCELLED' };
  }

  assertActor(challenge, action.actorUserId);

  if (secondPlayerStarted(challenge.status)) {
    throw new ChallengeRuleError('CHALLENGE_ALREADY_STARTED', 'A partida já começou.');
  }

  if (action.type === 'CANCEL') {
    if (action.actorUserId !== challenge.firstPlayerUserId) {
      throw new ChallengeRuleError('NOT_CHALLENGER', 'Só quem desafiou pode cancelar.');
    }
    return { cleanupPayload: true, status: 'CANCELLED' };
  }

  if (action.actorUserId !== challenge.secondPlayerUserId) {
    throw new ChallengeRuleError('NOT_CHALLENGED', 'Só quem foi desafiado pode recusar.');
  }
  return { cleanupPayload: true, status: 'DECLINED' };
}

/** Estado esperado depois que o segundo jogador aceita e começa a jogar. */
export function acceptedStatus(kind: ChallengeKind): ChallengeStatus {
  return kind === 'DIRECT' ? 'PREPARING' : 'SECOND_PLAYER_ACTIVE';
}

export interface SealedRoundAnswer {
  correct: boolean;
  remainingMs: number;
  score: number;
  selectedOption: number | null;
}

/**
 * Sigilo do assíncrono: nada do primeiro jogador atravessa antes de o segundo
 * resolver a rodada correspondente, e nenhuma rodada futura é revelada.
 *
 * `resolvedRounds` é a quantidade de rodadas que o segundo jogador já respondeu ou
 * deixou expirar. Revelar exige `roundNumber <= resolvedRounds`.
 */
export function revealableRounds(resolvedRounds: number, totalRounds: number): number {
  if (!Number.isInteger(resolvedRounds) || resolvedRounds < 0) throw new RangeError('Rodadas resolvidas inválidas.');
  if (!Number.isInteger(totalRounds) || totalRounds < 0) throw new RangeError('Total de rodadas inválido.');
  return Math.min(resolvedRounds, totalRounds);
}

export function canRevealFirstPlayerRound(roundNumber: number, resolvedRounds: number): boolean {
  return Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= resolvedRounds;
}

/**
 * Filtra a metade selada do primeiro jogador para o que o segundo pode ver agora.
 * O índice do array é `roundNumber - 1`.
 */
export function visibleFirstPlayerAnswers(
  sealed: readonly SealedRoundAnswer[],
  resolvedRounds: number,
): (SealedRoundAnswer | null)[] {
  return sealed.map((answer, index) => (
    canRevealFirstPlayerRound(index + 1, resolvedRounds) ? answer : null
  ));
}

/**
 * Score acumulado do primeiro jogador que pode ser mostrado ao segundo: apenas as
 * rodadas já resolvidas por ele. Nunca antecipa o placar final.
 */
export function revealableFirstPlayerScore(
  sealed: readonly SealedRoundAnswer[],
  resolvedRounds: number,
): number {
  return sealed
    .slice(0, revealableRounds(resolvedRounds, sealed.length))
    .reduce((total, answer) => total + answer.score, 0);
}
