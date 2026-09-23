import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAdminRoleForUser } from '../index.js';
import { UserRepository } from '../repositories/user-repository.js';
import { fixture, userAt } from './challenge-fixture.worker.js';

/**
 * Arquivo isolado de propósito: `user_roles`/`audit_logs` são tabelas globais
 * sem escopo por fixture. Sob `--no-isolate` (usado por `npm run test:worker`),
 * o D1 é compartilhado por TODA a suíte, não só dentro de um arquivo — então os
 * hooks abaixo garantem partida de zero ADMIN (mesmo que outro arquivo tenha
 * deixado resíduo) e nunca deixam `audit_logs` vazar para
 * `admin-directory.worker.test.ts` (que lê `audit_logs` sem filtro em
 * `AuditLogRepository.list()`).
 */
describe('M12 — guardas de revogação de ADMIN', () => {
  beforeEach(async () => {
    await env.CORE_DB.prepare("DELETE FROM user_roles WHERE role = 'ADMIN'").run();
  });

  afterEach(async () => {
    // Cada teste parte de zero ADMIN: sem isso, o resíduo de um teste vira o
    // "segundo ADMIN" que destrava a revogação do próximo, de forma não-determinística.
    await env.CORE_DB.prepare("DELETE FROM user_roles WHERE role = 'ADMIN'").run();
    await env.CORE_DB.prepare("DELETE FROM audit_logs WHERE action IN ('GRANT_ADMIN_ROLE', 'REVOKE_ADMIN_ROLE')").run();
  });

  it('bloqueia revogar o único ADMIN restante, mas libera assim que outro existe', async () => {
    const { users } = await fixture(2);
    const target = userAt(users, 0);
    const other = userAt(users, 1);
    const users_ = new UserRepository(env.CORE_DB);

    await expect(users_.setAdminRole(target.id, true, target.id)).resolves.toBe('GRANTED');
    // Único ADMIN existente: a revogação não pode zerar a lista inteira.
    await expect(users_.setAdminRole(target.id, false, target.id)).resolves.toBe('LAST_ADMIN');
    expect((await users_.listForAdmin({ search: target.publicId })).users[0]).toMatchObject({ role: 'ADMIN' });

    await users_.setAdminRole(other.id, true, target.id);
    await expect(users_.setAdminRole(target.id, false, other.id)).resolves.toBe('REVOKED');
  });

  it('revogar alguém que já não é ADMIN continua idempotente, mesmo sem nenhum ADMIN na base', async () => {
    const { users } = await fixture(1);
    const neverAdmin = userAt(users, 0);
    const users_ = new UserRepository(env.CORE_DB);
    await expect(users_.setAdminRole(neverAdmin.id, false, neverAdmin.id)).resolves.toBe('REVOKED');
  });

  it('rota bloqueia auto-revogação e a revogação do único ADMIN, sem gravar auditoria', async () => {
    const { users } = await fixture(2);
    const actor = userAt(users, 0);
    const other = userAt(users, 1);
    const users_ = new UserRepository(env.CORE_DB);
    await users_.setAdminRole(actor.id, true, actor.id);

    await expect(setAdminRoleForUser(env, actor.id, actor.id, false))
      .rejects.toMatchObject({ code: 'CANNOT_REVOKE_SELF', status: 409 });
    // Ainda é o único ADMIN: mesmo um terceiro tentando revogar esbarra no gatilho de último ADMIN.
    await expect(setAdminRoleForUser(env, other.id, actor.id, false))
      .rejects.toMatchObject({ code: 'LAST_ADMIN_ROLE', status: 409 });
    expect((await users_.listForAdmin({ search: actor.publicId })).users[0]).toMatchObject({ role: 'ADMIN' });
    expect(await env.CORE_DB.prepare(
      "SELECT COUNT(*) AS total FROM audit_logs WHERE entity_id = ?1 AND action LIKE '%ADMIN_ROLE'",
    ).bind(actor.id).first()).toEqual({ total: 0 });
  });

  it('rota concede e revoga normalmente quando há mais de um ADMIN, gravando a auditoria', async () => {
    const { users } = await fixture(2);
    const actor = userAt(users, 0);
    const other = userAt(users, 1);
    const users_ = new UserRepository(env.CORE_DB);
    await users_.setAdminRole(actor.id, true, actor.id);

    await expect(setAdminRoleForUser(env, actor.id, other.id, true)).resolves.toBeInstanceOf(Response);
    await expect(setAdminRoleForUser(env, actor.id, other.id, false)).resolves.toBeInstanceOf(Response);
    expect(await env.CORE_DB.prepare(
      "SELECT action FROM audit_logs WHERE entity_id = ?1 ORDER BY created_at, action",
    ).bind(other.id).all()).toMatchObject({ results: [{ action: 'GRANT_ADMIN_ROLE' }, { action: 'REVOKE_ADMIN_ROLE' }] });
  });

  it('rota bloqueia revogar um UID de bootstrap mesmo sem a role gravada no banco', async () => {
    const { users } = await fixture(2);
    const actor = userAt(users, 0);
    const bootstrapUser = userAt(users, 1);
    const bootstrapEnv = { ...env, ADMIN_FIREBASE_UIDS: bootstrapUser.uid };
    await new UserRepository(env.CORE_DB).setAdminRole(actor.id, true, actor.id);

    // `bootstrapUser` nunca recebeu a role no banco — só tem acesso pelo UID de ambiente.
    await expect(setAdminRoleForUser(bootstrapEnv, actor.id, bootstrapUser.id, false))
      .rejects.toMatchObject({ code: 'CANNOT_REVOKE_BOOTSTRAP_ADMIN', status: 409 });
    expect(await env.CORE_DB.prepare(
      "SELECT 1 FROM user_roles WHERE user_id = ?1 AND role = 'ADMIN'",
    ).bind(bootstrapUser.id).first()).toBeNull();
  });
});
