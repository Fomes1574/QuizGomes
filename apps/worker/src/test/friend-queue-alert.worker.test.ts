import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { SocialRepository } from '../repositories/social-repository.js';
import { FRIEND_QUEUE_ALERT_LIMITS, resetSocialPushCacheForTests, SocialPushService } from '../services/social-push-service.js';
import { befriend, fixture, userAt } from './challenge-fixture.worker.js';

async function syntheticPrivateKeyPem(): Promise<string> {
  const generated = await crypto.subtle.generateKey({
    hash: 'SHA-256',
    modulusLength: 2048,
    name: 'RSASSA-PKCS1-v1_5',
    publicExponent: new Uint8Array([1, 0, 1]),
  }, true, ['sign', 'verify']);
  const exported = new Uint8Array(await crypto.subtle.exportKey('pkcs8', generated.privateKey));
  let binary = '';
  for (const byte of exported) binary += String.fromCharCode(byte);
  const body = btoa(binary).match(/.{1,64}/g)?.join('\n') ?? '';
  return [`-----BEGIN ${'PRIVATE KEY'}-----`, body, `-----END ${'PRIVATE KEY'}-----`].join('\n');
}

function fcmEnv(key: string): typeof env {
  return {
    ...env,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'synthetic-service@example.test', private_key: key, project_id: env.FIREBASE_PROJECT_ID,
    }),
  };
}

describe('aviso "seu amigo está na fila"', () => {
  it('só vai para quem ligou, não silenciou e está fora do app, com limites dos dois lados', async () => {
    resetSocialPushCacheForTests();
    const { users } = await fixture(5);
    const sender = userAt(users, 0);
    const optedIn = userAt(users, 1);
    const optedOut = userAt(users, 2);
    const muter = userAt(users, 3);
    const online = userAt(users, 4);
    for (const friend of [optedIn, optedOut, muter, online]) await befriend(sender, friend);
    const social = new SocialRepository(env.CORE_DB);
    for (const user of [optedIn, muter, online]) {
      await social.setFriendQueueAlerts(user.id, true);
      await social.registerInstallation(user.id, `fid_${user.id.replaceAll('-', '_').slice(0, 30)}`);
    }
    await social.muteFriend(muter.id, sender.publicId);

    const deliveries: Array<{ message: { data: Record<string, string>; fid: string } }> = [];
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (address === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(Response.json({ access_token: 'synthetic', expires_in: 3_600 }));
      }
      if (typeof init?.body !== 'string') throw new Error('Payload FCM ausente.');
      deliveries.push(JSON.parse(init.body) as (typeof deliveries)[number]);
      return Promise.resolve(Response.json({ name: 'ok' }));
    });
    const push = new SocialPushService(fcmEnv(await syntheticPrivateKeyPem()), social, fetcher);
    const send = () => push.sendFriendInQueue({
      isOnline: (ids) => Promise.resolve(new Set(ids.filter((id) => id === online.id))),
      mode: 'RANKED',
      origin: 'https://quiz.test',
      senderDisplayName: 'Gomes',
      senderUserId: sender.id,
      themeName: 'Elden Ring',
      themeSlug: 'elden-ring',
    });

    expect(await send()).toBe(1);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.message.data).toMatchObject({
      title: 'Seu amigo está na fila', type: 'FRIEND_IN_QUEUE', url: '/temas/elden-ring?jogar=rankeada',
    });

    // Remetente em intervalo: nenhuma nova rodada, mesmo com gente elegível.
    expect(await send()).toBe(0);
    expect(deliveries).toHaveLength(1);

    // Passado o intervalo do remetente, quem recebeu na última hora continua protegido.
    await env.CORE_DB.prepare('UPDATE friend_queue_alerts SET sent_at_ms = ?1 WHERE sender_user_id = ?2')
      .bind(Date.now() - FRIEND_QUEUE_ALERT_LIMITS.senderCooldownMs - 1_000, sender.id).run();
    expect(await send()).toBe(0);

    await env.CORE_DB.prepare('UPDATE friend_queue_alerts SET sent_at_ms = ?1 WHERE sender_user_id = ?2')
      .bind(Date.now() - FRIEND_QUEUE_ALERT_LIMITS.recipientCooldownMs - 1_000, sender.id).run();
    expect(await send()).toBe(1);
  });

  it('a preferência nasce desligada e liga/desliga', async () => {
    const { users } = await fixture(1);
    const user = userAt(users, 0);
    const social = new SocialRepository(env.CORE_DB);
    expect(await social.friendQueueAlertsEnabled(user.id)).toBe(false);
    await social.setFriendQueueAlerts(user.id, true);
    expect(await social.friendQueueAlertsEnabled(user.id)).toBe(true);
    await social.setFriendQueueAlerts(user.id, false);
    expect(await social.friendQueueAlertsEnabled(user.id)).toBe(false);
  });
});
