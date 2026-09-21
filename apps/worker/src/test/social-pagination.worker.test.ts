import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SocialRepository } from '../repositories/social-repository.js';

let sequence = 0;

async function manyUsers(count: number): Promise<{ id: string; publicId: string }[]> {
  sequence += 1;
  const prefix = `socpage${sequence}`;
  const users = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-user-${index}`,
    publicId: `#QG${prefix.toUpperCase()}${index}`,
  }));
  await env.CORE_DB.batch(users.flatMap((user) => [
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(user.id, `${user.id}-uid`),
    env.CORE_DB.prepare(
      'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
    ).bind(user.id, user.publicId, `Jogador ${user.id}`),
  ]));
  return users;
}

describe('M11/M12 — paginação de bloqueados e pedidos pendentes', () => {
  it('bloqueados além de 50 não são truncados: duas páginas cobrem todos, sem repetir', async () => {
    const [blocker] = await manyUsers(1);
    if (blocker === undefined) throw new Error('Fixture incompleta.');
    const blocked = await manyUsers(55);
    await env.CORE_DB.batch(blocked.map((target, index) => env.CORE_DB.prepare(
      `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at)
       VALUES (?1, ?2, ?3)`,
    ).bind(blocker.id, target.id, `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)));

    const social = new SocialRepository(env.CORE_DB);
    const first = await social.blockedUsers(blocker.id);
    expect(first.users).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await social.blockedUsers(blocker.id, first.nextCursor);
    expect(second.users).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.users, ...second.users].map((user) => user.publicId));
    expect(seen.size).toBe(55);
    expect([...seen].every((publicId) => blocked.some((target) => target.publicId === publicId))).toBe(true);
  });

  it('pedidos pendentes recebidos além de 50 não são truncados, e o snapshot expõe o cursor', async () => {
    const [recipient] = await manyUsers(1);
    if (recipient === undefined) throw new Error('Fixture incompleta.');
    const senders = await manyUsers(55);
    await env.CORE_DB.batch(senders.map((sender, index) => env.CORE_DB.prepare(
      `INSERT INTO friend_requests (id, sender_user_id, recipient_user_id, status, created_at)
       VALUES (?1, ?2, ?3, 'PENDING', ?4)`,
    ).bind(crypto.randomUUID(), sender.id, recipient.id, `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)));

    const social = new SocialRepository(env.CORE_DB);
    const first = await social.requests(recipient.id, 'incoming');
    expect(first.requests).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await social.requests(recipient.id, 'incoming', first.nextCursor);
    expect(second.requests).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.requests, ...second.requests].map((request) => request.user.publicId));
    expect(seen.size).toBe(55);

    const snapshot = await social.snapshot(recipient.id);
    expect(snapshot.incoming).toHaveLength(50);
    expect(snapshot.incomingNextCursor).not.toBeNull();
    expect(snapshot.outgoing).toEqual([]);
    expect(snapshot.outgoingNextCursor).toBeNull();
  });

  it('pedidos enviados (outgoing) também paginam sem truncar', async () => {
    const [sender] = await manyUsers(1);
    if (sender === undefined) throw new Error('Fixture incompleta.');
    const recipients = await manyUsers(52);
    await env.CORE_DB.batch(recipients.map((recipient, index) => env.CORE_DB.prepare(
      `INSERT INTO friend_requests (id, sender_user_id, recipient_user_id, status, created_at)
       VALUES (?1, ?2, ?3, 'PENDING', ?4)`,
    ).bind(crypto.randomUUID(), sender.id, recipient.id, `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)));

    const social = new SocialRepository(env.CORE_DB);
    const first = await social.requests(sender.id, 'outgoing');
    expect(first.requests).toHaveLength(50);
    const second = await social.requests(sender.id, 'outgoing', first.nextCursor);
    expect(second.requests).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});
