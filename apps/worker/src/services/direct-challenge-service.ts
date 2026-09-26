import {
  CHALLENGE_MODE,
  type ChallengeRecord,
  type LiveMatchPresentationProjection,
} from '@quiz-gomes/domain';
import type { Env } from '../env.js';
import { ApiError } from '../http/api-error.js';

interface RoomInitializationResult {
  error?: { code?: string };
  presentations?: Array<{
    presentation?: LiveMatchPresentationProjection;
    uid?: string;
  }>;
}

const SAFE_MATCH_FAILURE_CODES = new Set([
  'PLAYER_BUSY',
  'PROFILE_REQUIRED',
  'QUESTION_POOL_EMPTY',
  'QUESTION_POOL_INCONSISTENT',
  'QUESTION_POOL_INSUFFICIENT',
]);

function safeMatchFailureCode(value: unknown): string {
  return typeof value === 'string' && SAFE_MATCH_FAILURE_CODES.has(value)
    ? value
    : 'MATCH_INITIALIZATION_FAILED';
}

export interface DirectChallengeStart {
  presentations: Map<string, LiveMatchPresentationProjection>;
  roomId: string;
}

/**
 * Aceite de desafio simultâneo: reserva os dois jogadores, inicializa o MatchRoom
 * EXISTENTE e entrega as apresentações individuais.
 *
 * Nenhum motor novo é criado. A partir daqui valem M8 e M8.5 sem alteração: mesmo
 * scoring, mesmo timer, mesma reconexão de 10 s e mesmo resultado transacional. O
 * lock `active_match_players` continua sendo a barreira final contra duas partidas.
 *
 * `roomId` é decidido por quem chama, ANTES de qualquer escrita — normalmente já
 * persistido em `challenges.match_id` na mesma transação que tirou o desafio de
 * PENDING_DIRECT. Isso é o que torna `start` idempotente: MatchRoom já recusa uma
 * segunda inicialização por instância de DO, e a reserva de presença abaixo
 * reconhece um jogador que já está `preparing`/`playing` nesta mesma sala, em vez
 * de tratar isso como conflito. Retry de rede, duplo aceite ou uma reconexão que
 * repete a chamada convergem para a mesma sala, sem criar nada a mais.
 */
export class DirectChallengeService {
  constructor(private readonly env: Env) {}

  private async transition(
    uid: string,
    from: string[],
    to: string,
    resource: string | null,
    fromResource?: string,
  ): Promise<boolean> {
    const response = await this.env.PRESENCE_HUB
      .get(this.env.PRESENCE_HUB.idFromName(uid))
      .fetch('https://presence.internal/transition', {
        body: JSON.stringify({ from, fromResource, resource, to }),
        method: 'POST',
      });
    return response.ok;
  }

  private async presenceState(uid: string): Promise<{ activity: string; resource: string | null }> {
    const response = await this.env.PRESENCE_HUB.get(this.env.PRESENCE_HUB.idFromName(uid))
      .fetch('https://presence.internal/state');
    return response.json<{ activity: string; resource: string | null }>();
  }

  /**
   * Reserva idempotente: se este jogador já está `preparing`/`playing` NESTA
   * sala (a própria chamada anterior já reservou, ou esta é uma repetição), não
   * tenta transicionar de novo — `idle/invite -> preparing` falharia porque o
   * estado atual não está mais em `idle`/`invite`, e isso NÃO é ocupação real.
   *
   * Duas chamadas concorrentes para o MESMO desafio (double tap, outra aba, a
   * recuperação de uma corrida perdida) competem pela mesma transição: uma
   * vence o CAS, a outra recebe 409. Perder essa corrida não é ocupação real
   * quando o resultado é o que a própria chamada queria — por isso, ao falhar,
   * relê o estado antes de desistir.
   */
  private async ensureReserved(uid: string, roomId: string): Promise<boolean> {
    const current = await this.presenceState(uid);
    if ((current.activity === 'preparing' || current.activity === 'playing') && current.resource === roomId) {
      return true;
    }
    if (await this.transition(uid, ['idle', 'invite'], 'preparing', roomId)) return true;
    const after = await this.presenceState(uid);
    return (after.activity === 'preparing' || after.activity === 'playing') && after.resource === roomId;
  }

  private async release(uid: string, roomId: string): Promise<void> {
    await this.transition(uid, ['preparing'], 'idle', null, roomId);
  }

  async start(
    challenge: ChallengeRecord,
    firebaseUids: readonly [string, string],
    roomId: string,
  ): Promise<DirectChallengeStart> {
    const resource = `${challenge.themeId}:${CHALLENGE_MODE}`;
    const room = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(roomId));

    let initialization: RoomInitializationResult | null;
    let failureCode = 'MATCH_INITIALIZATION_FAILED';
    try {
      const response = await room.fetch('https://room.internal/initialize', {
        body: JSON.stringify({
          createdAtMs: Date.now(),
          firebaseUids: [firebaseUids[0], firebaseUids[1]],
          kind: 'DIRECT_LIVE',
          matchId: roomId,
          resource,
        }),
        method: 'POST',
      });
      const result = await response.json<RoomInitializationResult>();
      initialization = response.ok ? result : null;
      if (!response.ok) failureCode = safeMatchFailureCode(result.error?.code);
    } catch {
      initialization = null;
    }

    const presentations = new Map<string, LiveMatchPresentationProjection>();
    for (const entry of initialization?.presentations ?? []) {
      if (typeof entry.uid === 'string' && entry.presentation !== undefined) {
        presentations.set(entry.uid, entry.presentation);
      }
    }
    if (presentations.size !== 2) {
      throw new ApiError(409, failureCode, 'Não foi possível formar a partida deste desafio.');
    }

    // Reserva depois da inicialização, como na fila: a sala já existe e pode ser desfeita.
    const reservations = await Promise.all(firebaseUids.map((uid) => this.ensureReserved(uid, roomId)));
    if (!reservations.every(Boolean)) {
      try {
        await room.fetch('https://room.internal/system-failure', { method: 'POST' });
      } catch {
        // O alarme autoritativo da sala mantém a limpeza como fallback sistêmico.
      }
      await Promise.all(firebaseUids.map((uid) => this.release(uid, roomId)));
      throw new ApiError(409, 'PLAYER_BUSY', 'Um dos jogadores já está em outra partida.');
    }

    return { presentations, roomId };
  }
}
