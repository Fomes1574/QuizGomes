import type { Env } from '../env.js';

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
