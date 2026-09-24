import { env } from 'cloudflare:test';
import { SocialRepository } from '../repositories/social-repository.js';

/**
 * Fixture compartilhada dos testes de desafio.
 *
 * Vive fora de um arquivo `*.worker.test.ts` de propósito: é infraestrutura de
 * teste, não suíte. Cada chamada usa um prefixo novo para não colidir com o
 * índice único de `themes.name` nem com as amizades de outra suíte.
 */

export interface FixtureUser {
  id: string;
  publicId: string;
  uid: string;
}

let sequence = 0;

export async function fixture(count: number): Promise<{ themeSlug: string; users: FixtureUser[] }> {
  sequence += 1;
  const prefix = `chal${sequence}-${crypto.randomUUID().slice(0, 6)}`;
  const users = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-user-${index}`,
    publicId: `#QG${prefix.toUpperCase().replaceAll('-', '')}${index}`,
    uid: `${prefix}-firebase-${index}`,
  }));
  const themeId = `${prefix}-theme`;
  const themeSlug = `${prefix}-theme`;
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order)
       VALUES ('challenge-category', 'challenge-category', 'Categoria de desafio', 998)`,
    ),
    ...users.flatMap((user) => [
      env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(user.id, user.uid),
      env.CORE_DB.prepare(
        'INSERT INTO user_profiles (user_id, public_id, display_name) VALUES (?1, ?2, ?3)',
      ).bind(user.id, user.publicId, `Jogador ${user.id}`),
    ]),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, 'challenge-category', ?2, ?3, 'Fixture.', 'ACTIVE', 'OFFICIAL', 'questions-01', 40)`,
    ).bind(themeId, themeSlug, `Tema ${prefix}`),
  ]);
  // Pool único e real em QUESTIONS_DB (um pool por tema) para os desafios
  // assíncronos poderem selar o conjunto. `difficulty` permanece só como
  // coluna física herdada, sem significado para o sorteio nem para o desafio.
  const poolId = `${themeId}:pool`;
  const poolQuestionCount = 16;
  const statements = [env.QUESTIONS_DB.prepare(
    `INSERT INTO question_pools (id, theme_id, difficulty, active_count)
     VALUES (?1, ?2, 'MEDIUM', ?3)`,
  ).bind(poolId, themeId, poolQuestionCount)];
  for (let index = 1; index <= poolQuestionCount; index += 1) {
    statements.push(env.QUESTIONS_DB.prepare(
      `INSERT INTO questions
        (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
         correct_option, content_hash, status)
       VALUES (?1, ?2, ?3, ?4, 'Correta', 'B', 'C', 'D', 0, ?5, 'ACTIVE')`,
    ).bind(`${poolId}-q-${index}`, poolId, index, `[FIXTURE] ${index}?`, `${poolId}-hash-${index}`));
  }
  await env.QUESTIONS_DB.batch(statements);
  return { themeSlug, users };
}

export function userAt(users: FixtureUser[], index: number): FixtureUser {
  const user = users[index];
  if (user === undefined) throw new Error('Fixture de desafio incompleta.');
  return user;
}

export async function befriend(first: FixtureUser, second: FixtureUser): Promise<void> {
  const social = new SocialRepository(env.CORE_DB);
  const request = await social.sendRequest(first.id, second.publicId);
  await social.acceptRequest(second.id, request.requestId);
}

export async function themeIdOf(slug: string): Promise<string> {
  const row = await env.CORE_DB.prepare('SELECT id FROM themes WHERE slug = ?1').bind(slug).first<{ id: string }>();
  if (row === null) throw new Error('Tema ausente.');
  return row.id;
}
