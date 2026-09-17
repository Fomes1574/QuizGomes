import type { Env } from '../env.js';
import { SocialRepository } from '../repositories/social-repository.js';
import { SocialPushService } from './social-push-service.js';

/**
 * Aviso realtime de mudança autoritativa de desafio, pelo canal social existente.
 *
 * Toda transição relevante avisa os DOIS participantes, para as duas telas
 * convergirem sem polling e sem reload. Falha de entrega nunca desfaz a transição
 * já persistida: o estado no D1 continua sendo a verdade.
 */
export async function notifyChallengeUpdated(
  env: Env,
  challengeId: string,
  userIds: readonly string[],
): Promise<void> {
  try {
    await env.SOCIAL_REALTIME_HUB
      .get(env.SOCIAL_REALTIME_HUB.idFromName('global'))
      .fetch('https://social.internal/notify', {
        body: JSON.stringify({
          event: { challengeId, type: 'CHALLENGE_UPDATED' },
          userIds: [...userIds],
        }),
        method: 'POST',
      });
  } catch {
    console.error(JSON.stringify({
      code: 'SOCIAL_REALTIME_UNAVAILABLE',
      event: 'challenge_notification_failed',
    }));
  }
}

/**
 * Push best-effort de "sua vez de jogar" para o segundo jogador do ASYNC,
 * disparado só quando a primeira metade realmente selou (nunca em retry
 * idempotente nem em corrida perdida). Ausência ou falha de FCM nunca altera
 * o desafio — é só um aviso a mais, best-effort de verdade.
 */
export async function notifyChallengeReadyForSecond(
  env: Env,
  input: {
    challengeId: string;
    firstPlayerDisplayName: string;
    firstPlayerUserId: string;
    secondPlayerUserId: string;
  },
): Promise<void> {
  try {
    const social = new SocialRepository(env.CORE_DB);
    const push = new SocialPushService(env, social);
    if (!push.configured) return;
    // Já com o canal social aberto, o CHALLENGE_UPDATED ao vivo já chegou:
    // nenhum motivo para duplicar em push.
    const onlineResponse = await env.SOCIAL_REALTIME_HUB.get(env.SOCIAL_REALTIME_HUB.idFromName('global'))
      .fetch('https://social.internal/online', {
        body: JSON.stringify({ userIds: [input.secondPlayerUserId] }),
        method: 'POST',
      });
    if (onlineResponse.ok) {
      const { online } = await onlineResponse.json<{ online: string[] }>();
      if (online.includes(input.secondPlayerUserId)) return;
    }
    await push.sendChallengeReady({
      challengeId: input.challengeId,
      challengerDisplayName: input.firstPlayerDisplayName,
      challengerUserId: input.firstPlayerUserId,
      origin: (env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim() ?? '',
      targetUserId: input.secondPlayerUserId,
    });
  } catch {
    console.error(JSON.stringify({
      challengeId: input.challengeId,
      code: 'CHALLENGE_READY_PUSH_FAILED',
    }));
  }
}
