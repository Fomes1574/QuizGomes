import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FRIEND_REQUEST_COOLDOWN_MS, SocialRepository } from '../repositories/social-repository.js';
import { resetSocialPushCacheForTests, SocialPushService } from '../services/social-push-service.js';

interface FixtureUser {
  id: string;
  publicId: string;
  uid: string;
}

let sequence = 0;

async function fixture(names: string[]): Promise<FixtureUser[]> {
  sequence += 1;
  const prefix = `social${sequence}`;
  const users = names.map((name, index) => ({
    id: `${prefix}-user-${index}`,
    name,
    publicId: `#QG${prefix.toUpperCase()}${index}`,
    uid: `${prefix}-firebase-${index}`,
  }));
  await env.CORE_DB.batch(users.flatMap((user) => [
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(user.id, user.uid),
    env.CORE_DB.prepare(
      `INSERT INTO user_profiles (user_id, public_id, display_name, photo_url, equipped_frame_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(user.id, user.publicId, user.name, `https://lh3.googleusercontent.com/${user.id}`, `frame-${user.id}`),
  ]));
  return users;
}

function userAt(users: FixtureUser[], index: number): FixtureUser {
  const user = users[index];
  if (user === undefined) throw new Error('Fixture social incompleta.');
  return user;
}

async function decline(repository: SocialRepository, sender: FixtureUser, target: FixtureUser): Promise<string> {
  const result = await repository.sendRequest(sender.id, target.publicId);
  await repository.rejectRequest(target.id, result.requestId);
  return result.requestId;
}

describe('Milestone 9A — Social Foundation no runtime Workers/D1', () => {
  beforeEach(() => resetSocialPushCacheForTests());

  it('busca nomes repetidos case-insensitive, ID exato, exclui self e nunca expõe dados privados', async () => {
    const users = await fixture(['Matheus', 'Matheus', 'Matheus Gomes', 'Outra pessoa']);
    const viewer = userAt(users, 0);
    const repository = new SocialRepository(env.CORE_DB);
    const results = await repository.search(viewer.id, 'mAtHeUs');

    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.displayName)).toEqual(['Matheus', 'Matheus Gomes']);
    expect(results.map((entry) => entry.publicId)).not.toContain(viewer.publicId);
    expect(results[0]?.frameId).toContain('frame-');
    expect(results[0]?.photoUrl).toContain('googleusercontent.com');
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain('firebase');
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('email');

    const direct = await repository.search(viewer.id, userAt(users, 2).publicId.toLowerCase());
    expect(direct.map((entry) => entry.publicId)).toEqual([userAt(users, 2).publicId]);
    expect(await repository.search(viewer.id, userAt(users, 2).publicId.slice(0, -1))).toEqual([]);
    expect(await repository.search(viewer.id, 'm')).toEqual([]);
  });

  it('limita busca nominal indexável e rejeita self/inexistente sem enumerar usuários', async () => {
    const users = await fixture(['Limitador', ...Array.from({ length: 24 }, (_, index) => `Grupo ${index}`)]);
    const actor = userAt(users, 0);
    const repository = new SocialRepository(env.CORE_DB);
    expect(await repository.search(actor.id, 'gr')).toHaveLength(20);
    await expect(repository.sendRequest(actor.id, actor.publicId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    await expect(repository.sendRequest(actor.id, '#QGNONEXISTENT'))
      .rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
  });

  it('cria apenas um pedido, impede cross-request e aceita idempotentemente uma amizade normalizada', async () => {
    const users = await fixture(['Pedido Alice', 'Pedido Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);

    const first = await repository.sendRequest(alice.id, bia.publicId);
    const repeated = await repository.sendRequest(alice.id, bia.publicId);
    expect(first.created).toBe(true);
    expect(repeated).toEqual({ ...first, created: false });
    await expect(repository.sendRequest(bia.id, alice.publicId))
      .rejects.toMatchObject({ code: 'INCOMING_REQUEST_EXISTS' });
    expect(await repository.pendingCount(bia.id)).toBe(1);
    expect((await repository.snapshot(alice.id)).outgoing).toHaveLength(1);
    expect((await repository.snapshot(bia.id)).incoming).toHaveLength(1);

    await repository.acceptRequest(bia.id, first.requestId);
    await repository.acceptRequest(bia.id, first.requestId);
    const friendships = await env.CORE_DB.prepare(
      'SELECT user_low_id, user_high_id FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(alice.id, bia.id).all();
    expect(friendships.results).toHaveLength(1);
    expect(await repository.pendingCount(bia.id)).toBe(0);
    await expect(repository.sendRequest(alice.id, bia.publicId))
      .rejects.toMatchObject({ code: 'ALREADY_FRIENDS' });

    await repository.removeFriend(alice.id, bia.publicId);
    expect((await repository.snapshot(alice.id)).friends).toEqual([]);
    expect((await repository.sendRequest(bia.id, alice.publicId)).created).toBe(true);
  });

  it('cancelamento do remetente não cria recusa nem cooldown', async () => {
    const users = await fixture(['Cancelar Alice', 'Cancelar Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    const result = await repository.sendRequest(alice.id, bia.publicId);

    await expect(repository.acceptRequest(alice.id, result.requestId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    await expect(repository.rejectRequest(alice.id, result.requestId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    await expect(repository.cancelRequest(bia.id, result.requestId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    await repository.cancelRequest(alice.id, result.requestId);
    await repository.cancelRequest(alice.id, result.requestId);
    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(alice.id, bia.id).first()).toBeNull();
    expect((await repository.sendRequest(alice.id, bia.publicId)).created).toBe(true);
  });

  it('aplica exatamente três recusas e cooldown de 30 dias somente na direção A→B', async () => {
    const users = await fixture(['Ciclo Alice', 'Ciclo Bia', 'Ciclo Caio']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const caio = userAt(users, 2);
    let now = new Date('2026-08-21T12:00:00.000Z');
    const repository = new SocialRepository(env.CORE_DB, () => now);

    for (let expected = 1; expected <= 3; expected += 1) {
      await decline(repository, alice, bia);
      expect(await env.CORE_DB.prepare(
        `SELECT rejection_count, cooldown_until FROM friend_request_pair_state
          WHERE requester_user_id = ?1 AND target_user_id = ?2`,
      ).bind(alice.id, bia.id).first()).toEqual({
        cooldown_until: expected === 3 ? '2026-09-20T12:00:00.000Z' : null,
        rejection_count: expected,
      });
    }
    await expect(repository.sendRequest(alice.id, bia.publicId)).rejects.toMatchObject({
      code: 'FRIEND_REQUEST_COOLDOWN',
      details: { availableAt: '2026-09-20T12:00:00.000Z' },
    });
    expect((await repository.sendRequest(alice.id, caio.publicId)).created).toBe(true);
    const reverse = await repository.sendRequest(bia.id, alice.publicId);
    expect(reverse.created).toBe(true);
    const unrelated = await repository.sendRequest(caio.id, bia.publicId);
    expect(unrelated.created).toBe(true);
    await repository.cancelRequest(bia.id, reverse.requestId);

    now = new Date(now.getTime() + FRIEND_REQUEST_COOLDOWN_MS);
    const renewed = await repository.sendRequest(alice.id, bia.publicId);
    expect(renewed.created).toBe(true);
    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(alice.id, bia.id).first()).toBeNull();
    await repository.rejectRequest(bia.id, renewed.requestId);
    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count, cooldown_until FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(alice.id, bia.id).first()).toEqual({ cooldown_until: null, rejection_count: 1 });
  });

  it('aceite após duas recusas limpa somente o histórico direcional e permite novo pedido após desfazer amizade', async () => {
    const users = await fixture(['Aceite Alice', 'Aceite Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    await decline(repository, alice, bia);
    await decline(repository, alice, bia);
    const accepted = await repository.sendRequest(alice.id, bia.publicId);
    await repository.acceptRequest(bia.id, accepted.requestId);

    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(alice.id, bia.id).first()).toBeNull();
    await repository.removeFriend(bia.id, alice.publicId);
    expect((await repository.sendRequest(alice.id, bia.publicId)).created).toBe(true);
  });

  it('bloqueio remove amizade/pedidos, esconde ambos sem vazar existência e desbloqueio não restaura vínculos', async () => {
    const users = await fixture(['Bloqueio Alice', 'Bloqueio Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    const accepted = await repository.sendRequest(alice.id, bia.publicId);
    await repository.acceptRequest(bia.id, accepted.requestId);
    await repository.block(alice.id, bia.publicId);

    expect((await repository.snapshot(alice.id)).friends).toEqual([]);
    expect((await repository.snapshot(bia.id)).friends).toEqual([]);
    expect(await repository.search(alice.id, 'Bloqueio')).toEqual([]);
    expect(await repository.search(bia.id, 'Bloqueio')).toEqual([]);
    expect(await repository.search(bia.id, alice.publicId)).toEqual([]);
    await expect(repository.sendRequest(bia.id, alice.publicId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    await expect(repository.sendRequest(alice.id, bia.publicId)).rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    expect((await repository.blockedUsers(alice.id)).map((entry) => entry.publicId)).toEqual([bia.publicId]);
    expect(await repository.blockedUsers(bia.id)).toEqual([]);

    await repository.unblock(alice.id, bia.publicId);
    expect((await repository.snapshot(alice.id)).friends).toEqual([]);
    expect((await repository.snapshot(alice.id)).incoming).toEqual([]);
    const pending = await repository.sendRequest(bia.id, alice.publicId);
    await repository.block(alice.id, bia.publicId);
    expect(await env.CORE_DB.prepare('SELECT status FROM friend_requests WHERE id = ?1')
      .bind(pending.requestId).first()).toEqual({ status: 'CANCELLED' });
    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(bia.id, alice.id).first()).toBeNull();
  });

  it('bloquear e desbloquear preserva o cooldown direcional existente', async () => {
    const users = await fixture(['Preservar Alice', 'Preservar Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    await decline(repository, alice, bia);
    await decline(repository, alice, bia);
    await decline(repository, alice, bia);
    await repository.block(alice.id, bia.publicId);
    await repository.unblock(alice.id, bia.publicId);
    await expect(repository.sendRequest(alice.id, bia.publicId))
      .rejects.toMatchObject({ code: 'FRIEND_REQUEST_COOLDOWN' });
  });

  it('bloquear cancela pedido do próprio remetente sem incrementar recusas', async () => {
    const users = await fixture(['Origem Alice', 'Origem Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    const request = await repository.sendRequest(alice.id, bia.publicId);
    await repository.block(alice.id, bia.publicId);
    expect(await env.CORE_DB.prepare('SELECT status FROM friend_requests WHERE id = ?1')
      .bind(request.requestId).first()).toEqual({ status: 'CANCELLED' });
    expect(await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(alice.id, bia.id).first()).toBeNull();
  });

  it('concorrência cruzada cria no máximo um PENDING e aceitar versus recusar resolve uma vez', async () => {
    const users = await fixture(['Corrida Alice', 'Corrida Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    await Promise.allSettled([
      repository.sendRequest(alice.id, bia.publicId),
      repository.sendRequest(bia.id, alice.publicId),
    ]);
    const pending = await env.CORE_DB.prepare(
      'SELECT id, sender_user_id, recipient_user_id FROM friend_requests WHERE status = ?1 AND sender_user_id IN (?2, ?3)',
    ).bind('PENDING', alice.id, bia.id).all<{
      id: string;
      recipient_user_id: string;
      sender_user_id: string;
    }>();
    expect(pending.results).toHaveLength(1);
    const request = pending.results[0];
    if (request === undefined) throw new Error('Pedido concorrente ausente.');

    await Promise.allSettled([
      repository.acceptRequest(request.recipient_user_id, request.id),
      repository.rejectRequest(request.recipient_user_id, request.id),
    ]);
    const result = await env.CORE_DB.prepare('SELECT status FROM friend_requests WHERE id = ?1')
      .bind(request.id).first<{ status: string }>();
    expect(['ACCEPTED', 'REJECTED']).toContain(result?.status);
    const friendships = await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM friendships WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(alice.id, bia.id).first<{ total: number }>();
    const states = await env.CORE_DB.prepare(
      'SELECT rejection_count FROM friend_request_pair_state WHERE requester_user_id = ?1 AND target_user_id = ?2',
    ).bind(request.sender_user_id, request.recipient_user_id).first<{ rejection_count: number }>();
    if (result?.status === 'ACCEPTED') {
      expect(friendships?.total).toBe(1);
      expect(states).toBeNull();
    } else {
      expect(friendships?.total).toBe(0);
      expect(states?.rejection_count).toBe(1);
    }
  });

  it('instalações FID são multi-device, pertencem ao dono e nunca entram em superfícies públicas', async () => {
    const users = await fixture(['Push Alice', 'Push Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    await repository.registerInstallation(alice.id, 'syntheticFID_A_123456');
    await repository.registerInstallation(alice.id, 'syntheticFID_B_123456');
    expect(await repository.enabledInstallations(alice.id)).toHaveLength(2);
    await expect(repository.registerInstallation(bia.id, 'syntheticFID_A_123456'))
      .rejects.toMatchObject({ code: 'INSTALLATION_UNAVAILABLE' });
    await expect(repository.unregisterInstallation(bia.id, 'syntheticFID_A_123456'))
      .rejects.toMatchObject({ code: 'USER_UNAVAILABLE' });
    expect(JSON.stringify(await repository.search(bia.id, 'Push'))).not.toContain('syntheticFID');
    await repository.unregisterInstallation(alice.id, 'syntheticFID_A_123456');
    expect(await repository.enabledInstallations(alice.id)).toEqual(['syntheticFID_B_123456']);
  });

  it('push ausente ou indisponível é best-effort e nunca desfaz o pedido persistido', async () => {
    const users = await fixture(['Opcional Alice', 'Opcional Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    await repository.registerInstallation(bia.id, 'syntheticFID_optional_123');
    const request = await repository.sendRequest(alice.id, bia.publicId);
    const unavailableFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error('fixture network unavailable')));
    const disabled = new SocialPushService(env, repository, unavailableFetch);
    expect(disabled.configured).toBe(false);
    await disabled.sendFriendRequest({
      origin: 'https://quiz.test',
      requestId: request.requestId,
      senderDisplayName: 'Opcional Alice',
      senderUserId: alice.id,
      targetUserId: bia.id,
    });
    expect(unavailableFetch).not.toHaveBeenCalled();
    expect(await env.CORE_DB.prepare('SELECT status FROM friend_requests WHERE id = ?1')
      .bind(request.requestId).first()).toEqual({ status: 'PENDING' });
  });

  it('envia somente por FID HTTP v1, evita duplicidade no retry e desativa instalação inválida', async () => {
    const users = await fixture(['Entrega Alice', 'Entrega Bia']);
    const alice = userAt(users, 0);
    const bia = userAt(users, 1);
    const repository = new SocialRepository(env.CORE_DB);
    const validFid = 'syntheticFID_valid_12345';
    const invalidFid = 'syntheticFID_invalid_123';
    await repository.registerInstallation(bia.id, validFid);
    await repository.registerInstallation(bia.id, invalidFid);
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
    const fixtureKey = [`-----BEGIN ${'PRIVATE KEY'}-----`, body, `-----END ${'PRIVATE KEY'}-----`].join('\n');
    const configuredEnv = {
      ...env,
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: 'synthetic-service@example.test',
        private_key: fixtureKey,
        project_id: env.FIREBASE_PROJECT_ID,
      }),
    };
    const deliveries: Array<{ message: { data: Record<string, string>; fid: string; token?: string } }> = [];
    const fetcher = vi.fn<typeof fetch>((input, initialization) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (address === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(Response.json({ access_token: 'synthetic-oauth-access-token', expires_in: 3600 }));
      }
      if (typeof initialization?.body !== 'string') throw new Error('Payload FCM sintético ausente.');
      const payload = JSON.parse(initialization.body) as (typeof deliveries)[number];
      deliveries.push(payload);
      if (payload.message.fid === invalidFid) {
        return Promise.resolve(Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }], status: 'NOT_FOUND' } }, {
          status: 404,
        }));
      }
      return Promise.resolve(Response.json({ name: 'projects/synthetic/messages/1' }));
    });
    const push = new SocialPushService(configuredEnv, repository, fetcher);
    expect(push.configured).toBe(true);
    const first = await repository.sendRequest(alice.id, bia.publicId);
    const repeated = await repository.sendRequest(alice.id, bia.publicId);
    expect(repeated.created).toBe(false);
    if (first.created) {
      await push.sendFriendRequest({
        origin: 'https://quiz.test',
        requestId: first.requestId,
        senderDisplayName: 'Entrega Alice',
        senderUserId: alice.id,
        targetUserId: bia.id,
      });
    }

    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((delivery) => delivery.message.fid).sort()).toEqual([invalidFid, validFid].sort());
    for (const delivery of deliveries) {
      expect(delivery.message.token).toBeUndefined();
      expect(delivery.message.data).toMatchObject({
        body: 'Entrega Alice quer adicionar você no Quiz Gomes',
        title: 'Novo pedido de amizade',
        type: 'FRIEND_REQUEST',
        url: '/social?section=pedidos',
      });
      expect(JSON.stringify(delivery.message.data)).not.toContain(alice.uid);
      expect(JSON.stringify(delivery.message.data)).not.toContain('@');
    }
    expect(await repository.enabledInstallations(bia.id)).toEqual([validFid]);
    expect(await env.CORE_DB.prepare(
      'SELECT last_success_at IS NOT NULL AS delivered FROM push_installations WHERE installation_id = ?1',
    ).bind(validFid).first()).toEqual({ delivered: 1 });
    expect(await env.CORE_DB.prepare('SELECT status FROM friend_requests WHERE id = ?1')
      .bind(first.requestId).first()).toEqual({ status: 'PENDING' });
  });

  it('todas as superfícies sociais exigem autenticação e não aceitam identidade arbitrária', async () => {
    const requests: Array<[string, RequestInit]> = [
      ['/api/social', {}],
      ['/api/social/summary', {}],
      ['/api/social/search?q=alice', {}],
      ['/api/social/blocks', {}],
      ['/api/social/requests', {
        body: JSON.stringify({ publicId: '#QGFAKE123', senderUserId: 'arbitrary' }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
      ['/api/social/push/installations', {
        body: JSON.stringify({ installationId: 'syntheticFID_123456' }),
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'arbitrary' },
        method: 'POST',
      }],
    ];
    for (const [path, options] of requests) {
      const response = await SELF.fetch(`https://quiz.test${path}`, options);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });
});
