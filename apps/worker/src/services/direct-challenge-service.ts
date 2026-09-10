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
 * scoring, mesmo timer, mesma reconexão de 7 s e mesmo resultado transacional. O
 * lock `active_match_players` continua sendo a barreira final contra duas partidas.
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

  private async release(uid: string, roomId: string): Promise<void> {
    await this.transition(uid, ['preparing'], 'idle', null, roomId);
  }

  async start(challenge: ChallengeRecord, firebaseUids: readonly [string, string]): Promise<DirectChallengeStart> {
    const roomId = crypto.randomUUID();
    const resource = `${challenge.themeId}:${challenge.difficulty}:${CHALLENGE_MODE}`;
    const room = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(roomId));

    let initialization: RoomInitializationResult | null;
    let failureCode = 'MATCH_INITIALIZATION_FAILED';
    try {
      const response = await room.fetch('https://room.internal/initialize', {
        body: JSON.stringify({
          createdAtMs: Date.now(),
          firebaseUids: [firebaseUids[0], firebaseUids[1]],
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
    const reservations = await Promise.all(firebaseUids.map(
      (uid) => this.transition(uid, ['idle', 'invite'], 'preparing', roomId),
    ));
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
