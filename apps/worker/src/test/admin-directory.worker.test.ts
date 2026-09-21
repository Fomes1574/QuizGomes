import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { AuditLogRepository } from '../repositories/audit-log-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';

describe('M11 — diretório ADMIN de usuários e papéis', () => {
  it('busca por ID público ou nome, paginada, sem truncar silenciosamente além da página', async () => {
    const { users } = await fixture(3);
    const users_ = new UserRepository(env.CORE_DB);
    const target = userAt(users, 0);

    const bySearch = await users_.listForAdmin({ search: target.publicId });
    expect(bySearch.users.map((row) => row.userId)).toEqual([target.id]);
    expect(bySearch.users[0]).toMatchObject({ publicId: target.publicId, role: 'PLAYER' });

    const byName = await users_.listForAdmin({ search: `Jogador ${target.id}` });
    expect(byName.users.map((row) => row.userId)).toContain(target.id);
  });

  it('conceder e revogar ADMIN é idempotente e refletido na listagem', async () => {
    const { users } = await fixture(2);
    const target = userAt(users, 0);
    const actor = userAt(users, 1);
    const users_ = new UserRepository(env.CORE_DB);

    await users_.setAdminRole(target.id, true, actor.id);
    await users_.setAdminRole(target.id, true, actor.id);
    const afterGrant = await users_.listForAdmin({ search: target.publicId });
    expect(afterGrant.users[0]).toMatchObject({ role: 'ADMIN' });

    await users_.setAdminRole(target.id, false, actor.id);
    await users_.setAdminRole(target.id, false, actor.id);
    const afterRevoke = await users_.listForAdmin({ search: target.publicId });
    expect(afterRevoke.users[0]).toMatchObject({ role: 'PLAYER' });
  });

  it('página de usuários é cursor-based: 60 usuários exigem duas páginas de 50', async () => {
    const { users } = await fixture(60);
    const users_ = new UserRepository(env.CORE_DB);
    const search = users[0]?.id.split('-user-')[0] ?? '';

    const first = await users_.listForAdmin({ search: `#QG${search.toUpperCase().replaceAll('-', '')}` });
    expect(first.users).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await users_.listForAdmin({ cursor: first.nextCursor, search: `#QG${search.toUpperCase().replaceAll('-', '')}` });
    expect(second.users).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.users, ...second.users].map((row) => row.userId));
    expect(seen.size).toBe(60);
  });
});

describe('M11 — trilha de auditoria (audit_logs)', () => {
  it('lista as ações mais recentes primeiro, com nome do ator quando existe', async () => {
    const { users } = await fixture(1);
    const actor = userAt(users, 0);
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?1, ?2, 'CREATE_CATEGORY', 'category', 'cat-1', '{"name":"Esportes"}', '2026-01-01T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), actor.id),
      env.CORE_DB.prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?1, ?2, 'APPROVE_THEME', 'theme', 'theme-1', '{}', '2026-01-02T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), actor.id),
      env.CORE_DB.prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?1, NULL, 'SYSTEM_EVENT', 'system', NULL, '{}', '2026-01-03T00:00:00.000Z')`,
      ).bind(crypto.randomUUID()),
    ]);

    const page = await new AuditLogRepository(env.CORE_DB).list();
    expect(page.entries.slice(0, 3)).toEqual([
      expect.objectContaining({ action: 'SYSTEM_EVENT', actorDisplayName: null, entityId: null }),
      expect.objectContaining({ action: 'APPROVE_THEME', actorDisplayName: `Jogador ${actor.id}`, entityId: 'theme-1' }),
      expect.objectContaining({ action: 'CREATE_CATEGORY', actorDisplayName: `Jogador ${actor.id}`, metadata: { name: 'Esportes' } }),
    ]);
  });

  it('metadata malformado nunca derruba a listagem: cai para objeto vazio', async () => {
    const id = crypto.randomUUID();
    await env.CORE_DB.prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json)
       VALUES (?1, NULL, 'BROKEN_METADATA', 'system', NULL, 'not-json')`,
    ).bind(id).run();
    const page = await new AuditLogRepository(env.CORE_DB).list();
    expect(page.entries.find((entry) => entry.id === id)).toMatchObject({ metadata: {} });
  });

  it('paginação cursor não trunca nem repete: 60 entradas exigem duas páginas de 50', async () => {
    const statements = Array.from({ length: 60 }, (_, index) => env.CORE_DB.prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?1, NULL, 'BULK_EVENT', 'system', NULL, '{}', ?2)`,
    ).bind(crypto.randomUUID(), `2020-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`));
    await env.CORE_DB.batch(statements);

    const audit = new AuditLogRepository(env.CORE_DB);
    const first = await audit.list();
    expect(first.entries.length).toBeGreaterThanOrEqual(50);
    const firstBulk = first.entries.filter((entry) => entry.action === 'BULK_EVENT');
    if (first.nextCursor === null) return;
    const second = await audit.list({ cursor: first.nextCursor });
    const secondBulk = second.entries.filter((entry) => entry.action === 'BULK_EVENT');
    const seen = new Set([...firstBulk, ...secondBulk].map((entry) => entry.id));
    expect(seen.size).toBe(firstBulk.length + secondBulk.length);
  });
});
