import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CI = 'true';
process.env.WRANGLER_SEND_ERROR_REPORTS = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_WRITE_LOGS = 'false';
for (const proxyVariable of ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy']) {
  delete process.env[proxyVariable];
}

const { unstable_splitSqlQuery: splitSqlQuery } = await import('wrangler');

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const coreSourceMigrationsDirectory = join(repositoryRoot, 'apps/worker/migrations/core');
const questionSourceMigrationsDirectory = join(repositoryRoot, 'apps/worker/migrations/questions');
const wranglerEntryPoint = join(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
const coreDatabaseName = 'quiz-gomes-core';
const questionDatabaseName = 'quiz-gomes-questions-01';
const syntheticCategoryId = 'category-synthetic-smoke-test-20260811';
const syntheticThemeId = 'theme-synthetic-smoke-test-multiplayer-20260811';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'quiz-gomes-d1-migrations-'));

/**
 * @typedef {{
 *   configPath: string,
 *   databaseName: string,
 *   directory: string,
 *   migrationsDirectory: string,
 *   name: string,
 *   persistenceDirectory: string,
 * }} MigrationScenario
 */

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {MigrationScenario} scenario
 * @param {string[]} args
 * @param {boolean} [expectFailure]
 */
function runWrangler(scenario, args, expectFailure = false) {
  const result = spawnSync(process.execPath, [wranglerEntryPoint, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      WRANGLER_SEND_ERROR_REPORTS: 'false',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false',
    },
  });
  const failed = result.status !== 0;
  if (failed !== expectFailure) {
    const expectation = expectFailure ? 'falhar' : 'concluir';
    throw new Error([
      `Wrangler deveria ${expectation} no cenário ${scenario.name}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

/** @param {MigrationScenario} scenario @param {boolean} [expectFailure] */
function applyMigrations(scenario, expectFailure = false) {
  return runWrangler(scenario, [
    'd1', 'migrations', 'apply', scenario.databaseName,
    '--local',
    '--persist-to', scenario.persistenceDirectory,
    '--config', scenario.configPath,
  ], expectFailure);
}

/** @param {MigrationScenario} scenario @param {string} sql @param {boolean} [expectFailure] */
function executeSql(scenario, sql, expectFailure = false) {
  return runWrangler(scenario, [
    'd1', 'execute', scenario.databaseName,
    '--local',
    '--persist-to', scenario.persistenceDirectory,
    '--config', scenario.configPath,
    '--command', sql,
    '--yes',
  ], expectFailure);
}

/** @param {MigrationScenario} scenario @param {string} sql @returns {Record<string, unknown>[]} */
function query(scenario, sql) {
  const result = runWrangler(scenario, [
    'd1', 'execute', scenario.databaseName,
    '--local',
    '--persist-to', scenario.persistenceDirectory,
    '--config', scenario.configPath,
    '--command', sql,
    '--json',
  ]);
  const batches = /** @type {unknown} */ (JSON.parse(result.stdout));
  assert(Array.isArray(batches), `${scenario.name}: saída JSON inesperada do Wrangler`);
  const rows = [];
  for (const batch of batches) {
    assert(typeof batch === 'object' && batch !== null, `${scenario.name}: batch JSON inválido`);
    const results = /** @type {{ results?: unknown }} */ (batch).results ?? [];
    assert(Array.isArray(results), `${scenario.name}: results JSON inválido`);
    for (const row of results) {
      assert(typeof row === 'object' && row !== null, `${scenario.name}: row JSON inválida`);
      rows.push(/** @type {Record<string, unknown>} */ (row));
    }
  }
  return rows;
}

/**
 * @param {string} name
 * @param {string[]} migrationNames
 * @param {{ binding?: string, databaseName?: string, migrationsSubdirectory?: string, sourceDirectory?: string }} [options]
 * @returns {Promise<MigrationScenario>}
 */
async function createScenario(name, migrationNames, options = {}) {
  const binding = options.binding ?? 'CORE_DB';
  const databaseName = options.databaseName ?? coreDatabaseName;
  const migrationsSubdirectory = options.migrationsSubdirectory ?? 'core';
  const sourceDirectory = options.sourceDirectory ?? coreSourceMigrationsDirectory;
  const directory = join(temporaryRoot, name);
  const migrationsDirectory = join(directory, 'migrations', migrationsSubdirectory);
  const persistenceDirectory = join(directory, 'state');
  const configPath = join(directory, 'wrangler.jsonc');
  await mkdir(migrationsDirectory, { recursive: true });
  await Promise.all(migrationNames.map((migrationName) => copyFile(
    join(sourceDirectory, migrationName),
    join(migrationsDirectory, migrationName),
  )));
  await writeFile(configPath, `${JSON.stringify({
    compatibility_date: '2026-08-10',
    d1_databases: [{
      binding,
      database_id: '00000000-0000-0000-0000-000000000001',
      database_name: databaseName,
      migrations_dir: `migrations/${migrationsSubdirectory}`,
    }],
    name: `quiz-gomes-migration-validator-${name}`,
  }, null, 2)}\n`, 'utf8');
  return { configPath, databaseName, directory, migrationsDirectory, name, persistenceDirectory };
}

/** @param {MigrationScenario} scenario */
function assertFinalSchema(scenario) {
  const schemaObjects = query(scenario, `
    SELECT name, type
      FROM sqlite_master
     WHERE name IN (
       'theme_artwork_blobs', 'themes_artwork_parent_key', 'user_custom_avatars',
       'friend_request_pair_state', 'user_blocks', 'push_installations',
       'friendship_mutes', 'challenges', 'challenge_questions', 'challenge_answers',
       'idx_friend_requests_pending_unordered_pair', 'idx_user_blocks_blocked_blocker',
       'idx_push_installations_user_enabled', 'idx_friendships_high',
       'idx_challenges_live_pair_async', 'idx_challenges_live_pair_direct',
       'idx_challenges_pair_kind_status', 'idx_challenges_second_player',
       'idx_challenges_first_player', 'idx_challenges_direct_expiry',
       'idx_challenge_answers_user', 'question_reports', 'question_report_views',
       'idx_question_reports_open_per_user_context', 'idx_question_reports_status_created',
       'idx_question_reports_question', 'idx_question_reports_reporter_created',
       'idx_question_report_views_proof', 'user_daily_missions', 'user_theme_streaks',
       'idx_user_daily_missions_user_day', 'idx_user_theme_streaks_active',
       'challenge_xp_ledger', 'challenge_progression_ledger', 'idx_users_admin_listing'
     )
        OR type = 'trigger'
     ORDER BY type, name
  `);
  assert(
    schemaObjects.some(({ name, type }) => name === 'theme_artwork_blobs' && type === 'table'),
    `${scenario.name}: tabela theme_artwork_blobs ausente`,
  );
  assert(
    schemaObjects.some(({ name, type }) => name === 'themes_artwork_parent_key' && type === 'index'),
    `${scenario.name}: índice pai da arte ausente`,
  );
  assert(
    schemaObjects.some(({ name, type }) => name === 'user_custom_avatars' && type === 'table'),
    `${scenario.name}: tabela user_custom_avatars ausente`,
  );
  for (const tableName of [
    'friend_request_pair_state', 'user_blocks', 'push_installations',
    'friendship_mutes', 'challenges', 'challenge_questions', 'challenge_answers',
    'question_reports', 'question_report_views', 'user_daily_missions', 'user_theme_streaks',
    'challenge_xp_ledger', 'challenge_progression_ledger',
  ]) {
    assert(
      schemaObjects.some(({ name, type }) => name === tableName && type === 'table'),
      `${scenario.name}: tabela social ${tableName} ausente`,
    );
  }
  for (const indexName of [
    'idx_friend_requests_pending_unordered_pair',
    'idx_user_blocks_blocked_blocker',
    'idx_push_installations_user_enabled',
    'idx_friendships_high',
    'idx_challenges_live_pair_async',
    'idx_challenges_live_pair_direct',
    'idx_challenges_pair_kind_status',
    'idx_challenges_second_player',
    'idx_challenges_first_player',
    'idx_challenges_direct_expiry',
    'idx_challenge_answers_user',
    'idx_question_reports_open_per_user_context',
    'idx_question_reports_status_created',
    'idx_question_reports_question',
    'idx_question_reports_reporter_created', 'idx_question_report_views_proof',
    'idx_user_daily_missions_user_day', 'idx_user_theme_streaks_active',
    'idx_users_admin_listing',
  ]) {
    assert(
      schemaObjects.some(({ name, type }) => name === indexName && type === 'index'),
      `${scenario.name}: índice social ${indexName} ausente`,
    );
  }
  assert(!schemaObjects.some(({ type }) => type === 'trigger'), `${scenario.name}: migration criou trigger remoto frágil`);

  const themeColumns = query(scenario, 'PRAGMA table_info(themes)');
  for (const columnName of ['artwork_icon_key', 'artwork_version', 'artwork_kind', 'revision', 'rejection_note']) {
    assert(themeColumns.some(({ name }) => name === columnName), `${scenario.name}: coluna ${columnName} ausente`);
  }
  const categoryColumns = query(scenario, 'PRAGMA table_info(categories)');
  assert(
    categoryColumns.some(({ name }) => name === 'revision'),
    `${scenario.name}: coluna revision de categories ausente`,
  );

  const foreignKeys = query(scenario, 'PRAGMA foreign_key_list(theme_artwork_blobs)');
  const expectedForeignKey = [
    ['theme_id', 'id'],
    ['version', 'artwork_version'],
    ['artwork_kind', 'artwork_kind'],
  ];
  for (const [from, to] of expectedForeignKey) {
    assert(foreignKeys.some((foreignKey) => (
      foreignKey.from === from
      && foreignKey.to === to
      && foreignKey.on_update === 'CASCADE'
      && foreignKey.on_delete === 'CASCADE'
    )), `${scenario.name}: FK composta ausente em ${from} → ${to}`);
  }

  const avatarForeignKeys = query(scenario, 'PRAGMA foreign_key_list(user_custom_avatars)');
  assert(
    avatarForeignKeys.some((foreignKey) => (
      foreignKey.from === 'user_id'
      && foreignKey.to === 'id'
      && foreignKey.on_delete === 'CASCADE'
    )),
    `${scenario.name}: FK do avatar para users ausente`,
  );

  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.at(-1)?.name === '0018_friend_queue_alerts.sql',
    `${scenario.name}: 0018 de avisos de amigo na fila não foi registrada como última migration`,
  );
  assertPersonalRecordsAndVotesSchema(scenario);
  assertFriendQueueAlertsSchema(scenario);
  const upgradedTheme = query(scenario, `
    SELECT artwork_kind, artwork_icon_key, artwork_version, active_question_count
      FROM themes
     WHERE id = '${syntheticThemeId}'
  `);
  assert(
    upgradedTheme.length === 1
      && upgradedTheme[0].artwork_kind === 'NONE'
      && upgradedTheme[0].artwork_icon_key === null
      && upgradedTheme[0].artwork_version === 0
      && upgradedTheme[0].active_question_count === 250,
    `${scenario.name}: defaults da 0004 não preservaram o tema vindo da 0003`,
  );
}

/** @param {MigrationScenario} scenario */
function assertSocialInvariants(scenario) {
  const first = `social-a-${scenario.name}`;
  const second = `social-b-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid)
    VALUES ('${first}', 'firebase-${first}'), ('${second}', 'firebase-${second}');
    INSERT INTO friend_requests (id, sender_user_id, recipient_user_id)
    VALUES ('pending-${scenario.name}', '${first}', '${second}');
  `);
  executeSql(scenario, `
    INSERT INTO friend_requests (id, sender_user_id, recipient_user_id)
    VALUES ('crossed-${scenario.name}', '${second}', '${first}')
  `, true);
  executeSql(scenario, `
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
    VALUES ('${first}', '${first}')
  `, true);
  executeSql(scenario, `
    INSERT INTO friend_request_pair_state
      (requester_user_id, target_user_id, rejection_count, cooldown_until)
    VALUES ('${first}', '${second}', 3, NULL)
  `, true);
  executeSql(scenario, `
    INSERT INTO push_installations (installation_id, user_id)
    VALUES ('fid-synthetic-${scenario.name}', '${first}')
  `);
  const requests = query(scenario, `
    SELECT COUNT(*) AS total FROM friend_requests
     WHERE status = 'PENDING'
       AND ((sender_user_id = '${first}' AND recipient_user_id = '${second}')
         OR (sender_user_id = '${second}' AND recipient_user_id = '${first}'))
  `);
  assert(requests[0]?.total === 1, `${scenario.name}: índice social permitiu pedidos cruzados`);
}

/** @param {MigrationScenario} scenario */
function assertChallengeInvariants(scenario) {
  const first = `challenge-a-${scenario.name}`;
  const second = `challenge-b-${scenario.name}`;
  const third = `challenge-c-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES
      ('${first}', 'firebase-${first}'),
      ('${second}', 'firebase-${second}'),
      ('${third}', 'firebase-${third}');
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('async-${scenario.name}', '${first}', '${second}', '${first}', '${second}',
            '${syntheticThemeId}', 'MEDIUM', 'ASYNC', 'WAITING_FOR_SECOND');
  `);
  // Segundo ASYNC da mesma dupla, em qualquer direção, é barrado pelo índice do tipo.
  executeSql(scenario, `
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('crossed-${scenario.name}', '${first}', '${second}', '${second}', '${first}',
            '${syntheticThemeId}', 'EASY', 'ASYNC', 'FIRST_PLAYER_ACTIVE')
  `, true);
  // Um DIRECT convive com o ASYNC aguardando resposta: o limite é por tipo.
  executeSql(scenario, `
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status, expires_at)
    VALUES ('direct-${scenario.name}', '${first}', '${second}', '${first}', '${second}',
            '${syntheticThemeId}', 'EASY', 'DIRECT', 'PENDING_DIRECT', '2099-01-01T00:00:00.000Z')
  `);
  // Mas um segundo DIRECT vivo para a mesma dupla continua proibido.
  executeSql(scenario, `
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status, expires_at)
    VALUES ('direct-dup-${scenario.name}', '${first}', '${second}', '${second}', '${first}',
            '${syntheticThemeId}', 'EASY', 'DIRECT', 'PENDING_DIRECT', '2099-01-01T00:00:00.000Z')
  `, true);
  // Duplas diferentes continuam livres.
  executeSql(scenario, `
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('other-pair-${scenario.name}', '${first}', '${third}', '${first}', '${third}',
            '${syntheticThemeId}', 'EASY', 'DIRECT', 'PENDING_DIRECT')
  `);
  // Encerrado o desafio, a dupla volta a aceitar um novo.
  executeSql(scenario, `
    UPDATE challenges SET status = 'COMPLETED' WHERE id = 'async-${scenario.name}';
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('reopened-${scenario.name}', '${first}', '${second}', '${second}', '${first}',
            '${syntheticThemeId}', 'HARD', 'ASYNC', 'FIRST_PLAYER_ACTIVE');
  `);
  // Par sempre normalizado e jogadores distintos.
  executeSql(scenario, `
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('unsorted-${scenario.name}', '${second}', '${first}', '${first}', '${second}',
            '${syntheticThemeId}', 'EASY', 'DIRECT', 'PENDING_DIRECT')
  `, true);
  executeSql(scenario, `
    INSERT INTO friendship_mutes (muter_user_id, muted_user_id)
    VALUES ('${first}', '${first}')
  `, true);
  executeSql(scenario, `
    INSERT INTO friendship_mutes (muter_user_id, muted_user_id)
    VALUES ('${first}', '${second}')
  `);
  const liveAsync = query(scenario, `
    SELECT COUNT(*) AS total FROM challenges
     WHERE pair_low_id = '${first}' AND pair_high_id = '${second}' AND kind = 'ASYNC'
       AND status IN ('PENDING_DIRECT', 'PREPARING', 'ACTIVE',
                      'FIRST_PLAYER_ACTIVE', 'WAITING_FOR_SECOND', 'SECOND_PLAYER_ACTIVE')
  `);
  assert(liveAsync[0]?.total === 1, `${scenario.name}: índice permitiu dois ASYNC ativos na mesma dupla`);
  const liveDirect = query(scenario, `
    SELECT COUNT(*) AS total FROM challenges
     WHERE pair_low_id = '${first}' AND pair_high_id = '${second}' AND kind = 'DIRECT'
       AND status IN ('PENDING_DIRECT', 'PREPARING', 'ACTIVE',
                      'FIRST_PLAYER_ACTIVE', 'WAITING_FOR_SECOND', 'SECOND_PLAYER_ACTIVE')
  `);
  assert(liveDirect[0]?.total === 1, `${scenario.name}: índice permitiu dois DIRECT ativos na mesma dupla`);
}

/** @param {MigrationScenario} scenario */
function assertChallengeCompletionLedgerInvariants(scenario) {
  const first = `ledger-a-${scenario.name}`;
  const second = `ledger-b-${scenario.name}`;
  const challengeId = `ledger-challenge-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES
      ('${first}', 'firebase-${first}'),
      ('${second}', 'firebase-${second}');
    INSERT INTO challenges
      (id, pair_low_id, pair_high_id, first_player_user_id, second_player_user_id,
       theme_id, difficulty, kind, status)
    VALUES ('${challengeId}', '${first}', '${second}', '${first}', '${second}',
            '${syntheticThemeId}', 'EASY', 'ASYNC', 'COMPLETED');
  `);
  // XP negativo é rejeitado pelo CHECK.
  executeSql(scenario, `
    INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta)
    VALUES ('${challengeId}', '${first}', -1)
  `, true);
  // applied fora de 0/1 é rejeitado pelo CHECK.
  executeSql(scenario, `
    INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta, applied)
    VALUES ('${challengeId}', '${first}', 10, 2)
  `, true);
  executeSql(scenario, `
    INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta) VALUES ('${challengeId}', '${first}', 10);
    INSERT INTO challenge_progression_ledger (challenge_id, user_id) VALUES ('${challengeId}', '${first}');
  `);
  // Chave primária (challenge_id, user_id): retry sem OR IGNORE colide, como o gatilho do padrão exige.
  executeSql(scenario, `
    INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta) VALUES ('${challengeId}', '${first}', 99)
  `, true);
  executeSql(scenario, `
    INSERT INTO challenge_xp_ledger (challenge_id, user_id, xp_delta) VALUES ('${challengeId}', '${first}', 99)
    ON CONFLICT (challenge_id, user_id) DO NOTHING
  `);
  const unchanged = query(scenario, `
    SELECT xp_delta FROM challenge_xp_ledger WHERE challenge_id = '${challengeId}' AND user_id = '${first}'
  `);
  assert(unchanged[0]?.xp_delta === 10, `${scenario.name}: retry do ledger de XP sobrescreveu um valor já aplicado`);
  // Ambos os ledgers declaram CASCADE para challenges(id), para nunca sobreviver a um desafio apagado.
  for (const tableName of ['challenge_xp_ledger', 'challenge_progression_ledger']) {
    const foreignKeys = query(scenario, `PRAGMA foreign_key_list(${tableName})`);
    assert(foreignKeys.some((foreignKey) => (
      foreignKey.table === 'challenges' && foreignKey.from === 'challenge_id'
        && foreignKey.to === 'id' && foreignKey.on_delete === 'CASCADE'
    )), `${scenario.name}: FK CASCADE de ${tableName} para challenges ausente`);
    assert(
      foreignKeys.some((foreignKey) => foreignKey.table === 'users' && foreignKey.from === 'user_id' && foreignKey.to === 'id'),
      `${scenario.name}: FK de ${tableName} para users ausente`,
    );
  }
}

/** @param {MigrationScenario} scenario */
function assertReportInvariants(scenario) {
  const reporter = `report-user-${scenario.name}`;
  const moderator = `report-mod-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES
      ('${reporter}', 'firebase-${reporter}'),
      ('${moderator}', 'firebase-${moderator}');
    INSERT INTO question_reports
      (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason)
    VALUES ('open-${scenario.name}', '${reporter}', 'question-x-${scenario.name}',
            'MATCH', 'match-${scenario.name}', 1, 'INCORRECT');
  `);
  // Mesma pessoa, mesmo contexto e rodada: a denúncia OPEN é única (idempotência).
  executeSql(scenario, `
    INSERT INTO question_reports
      (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason)
    VALUES ('open-dup-${scenario.name}', '${reporter}', 'question-x-${scenario.name}',
            'MATCH', 'match-${scenario.name}', 1, 'OUTDATED')
  `, true);
  // Motivo fora do catálogo é barrado pelo CHECK.
  executeSql(scenario, `
    INSERT INTO question_reports
      (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason)
    VALUES ('bad-reason-${scenario.name}', '${reporter}', 'question-y-${scenario.name}',
            'MATCH', 'match-${scenario.name}', 2, 'SPAM')
  `, true);
  // Nota além do limite também é barrada pelo CHECK, não só pela validação do domínio.
  executeSql(scenario, `
    INSERT INTO question_reports
      (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason, note)
    VALUES ('long-note-${scenario.name}', '${reporter}', 'question-z-${scenario.name}',
            'MATCH', 'match-${scenario.name}', 3, 'OTHER', '${'x'.repeat(281)}')
  `, true);
  // Resolvida, a mesma pessoa pode denunciar de novo o mesmo contexto+rodada.
  executeSql(scenario, `
    UPDATE question_reports
       SET status = 'DISMISSED', resolution_note = 'Verificado: correta.',
           resolved_by_user_id = '${moderator}', resolved_at = CURRENT_TIMESTAMP
     WHERE id = 'open-${scenario.name}';
    INSERT INTO question_reports
      (id, reporter_user_id, question_id, context_kind, context_id, round_number, reason)
    VALUES ('reopened-${scenario.name}', '${reporter}', 'question-x-${scenario.name}',
            'MATCH', 'match-${scenario.name}', 1, 'AMBIGUOUS');
  `);
  const openCount = query(scenario, `
    SELECT COUNT(*) AS total FROM question_reports
     WHERE reporter_user_id = '${reporter}' AND context_kind = 'MATCH'
       AND context_id = 'match-${scenario.name}' AND round_number = 1
       AND status IN ('OPEN', 'IN_REVIEW')
  `);
  assert(openCount[0]?.total === 1, `${scenario.name}: índice de denúncia permitiu duas abertas para o mesmo contexto`);
}

/** @param {MigrationScenario} scenario */
function assertReportViewInvariants(scenario) {
  const reporter = `report-view-user-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${reporter}', 'firebase-${reporter}');
    INSERT INTO question_report_views
      (context_kind, context_id, user_id, round_number, question_id)
    VALUES ('MATCH', 'match-view-${scenario.name}', '${reporter}', 1, 'question-view-${scenario.name}');
  `);
  // Um recibo é único por usuário/contexto/rodada: retry não pode trocar a pergunta recebida.
  executeSql(scenario, `
    INSERT INTO question_report_views
      (context_kind, context_id, user_id, round_number, question_id)
    VALUES ('MATCH', 'match-view-${scenario.name}', '${reporter}', 1, 'question-other-${scenario.name}');
  `, true);
  executeSql(scenario, `
    INSERT INTO question_report_views
      (context_kind, context_id, user_id, round_number, question_id)
    VALUES ('MATCH', 'match-invalid-${scenario.name}', '${reporter}', 13, 'question-invalid-${scenario.name}');
  `, true);
}

/** @param {MigrationScenario} scenario */
function assertEditorialInvariants(scenario) {
  const owner = `editorial-owner-${scenario.name}`;
  const themeId = `editorial-theme-${scenario.name}`;
  const categoryId = `editorial-category-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${owner}', 'firebase-${owner}');
    INSERT INTO categories (id, slug, name) VALUES ('${categoryId}', '${categoryId}', 'Categoria ${scenario.name}');
    INSERT INTO themes (
      id, category_id, slug, name, description, status, origin, created_by_user_id, question_shard_id
    ) VALUES (
      '${themeId}', '${categoryId}', '${themeId}', 'Tema ${scenario.name}', 'Fixture sintética.',
      'PENDING', 'USER', '${owner}', 'questions-01'
    );
  `);
  // CAS por revisão: a escrita com revisão desatualizada não aplica nada.
  executeSql(scenario, `
    UPDATE themes SET status = 'ACTIVE', revision = revision + 1
     WHERE id = '${themeId}' AND revision = 99;
  `);
  const stillPending = query(scenario, `SELECT status, revision FROM themes WHERE id = '${themeId}'`);
  assert(
    stillPending.length === 1 && stillPending[0].status === 'PENDING' && stillPending[0].revision === 1,
    `${scenario.name}: CAS de revisão do tema aplicou uma escrita com revisão errada`,
  );
  executeSql(scenario, `
    UPDATE themes SET status = 'ACTIVE', revision = revision + 1
     WHERE id = '${themeId}' AND revision = 1;
    INSERT INTO theme_ownership (theme_id, user_id) VALUES ('${themeId}', '${owner}');
  `);
  const approved = query(scenario, `SELECT status, revision FROM themes WHERE id = '${themeId}'`);
  assert(
    approved.length === 1 && approved[0].status === 'ACTIVE' && approved[0].revision === 2,
    `${scenario.name}: aprovação com revisão correta não avançou o tema`,
  );

  // Missões: par (usuário, dia, tipo) é único — gerar de novo é idempotente.
  executeSql(scenario, `
    INSERT INTO user_daily_missions (user_id, day_key, mission_type, target)
    VALUES
      ('${owner}', '2026-09-21', 'PLAY_MATCH', 1),
      ('${owner}', '2026-09-21', 'ANSWER_QUESTIONS', 8),
      ('${owner}', '2026-09-21', 'CORRECT_ANSWERS', 5);
  `);
  executeSql(scenario, `
    INSERT OR IGNORE INTO user_daily_missions (user_id, day_key, mission_type, target)
    VALUES ('${owner}', '2026-09-21', 'PLAY_MATCH', 1);
  `);
  const missions = query(scenario, `
    SELECT COUNT(*) AS total FROM user_daily_missions
     WHERE user_id = '${owner}' AND day_key = '2026-09-21'
  `);
  assert(missions[0]?.total === 3, `${scenario.name}: geração repetida de missões duplicou uma linha`);
  executeSql(scenario, `
    INSERT INTO user_daily_missions (user_id, day_key, mission_type, target)
    VALUES ('${owner}', '2026-09-21', 'SCAN_ALL', 1)
  `, true);

  // Streak: best nunca fica abaixo do current, e o fallback determinístico
  // usa o índice (user_id, current_streak DESC, theme_id).
  executeSql(scenario, `
    INSERT INTO user_theme_streaks (user_id, theme_id, current_streak, best_streak, last_active_day)
    VALUES ('${owner}', '${themeId}', 3, 5, '2026-09-20');
  `);
  executeSql(scenario, `
    UPDATE user_theme_streaks SET current_streak = 6 WHERE user_id = '${owner}' AND theme_id = '${themeId}'
  `, true);
  executeSql(scenario, `
    UPDATE user_theme_streaks
       SET current_streak = 6, best_streak = 6, last_active_day = '2026-09-21'
     WHERE user_id = '${owner}' AND theme_id = '${themeId}'
  `);
  const streak = query(scenario, `
    SELECT current_streak, best_streak FROM user_theme_streaks
     WHERE user_id = '${owner}' AND theme_id = '${themeId}'
  `);
  assert(
    streak.length === 1 && streak[0].current_streak === 6 && streak[0].best_streak === 6,
    `${scenario.name}: streak não avançou current/best juntos`,
  );
}

/** @param {MigrationScenario} scenario */
function assertQuestionVersioningInvariants(scenario) {
  const actor = `versioning-actor-${scenario.name}`;
  const poolId = `versioning-pool-${scenario.name}`;
  const activeId = `versioning-active-${scenario.name}`;
  const draftId = `versioning-draft-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO question_pools (id, theme_id, difficulty, active_count)
    VALUES ('${poolId}', 'theme-${scenario.name}', 'EASY', 1);
    INSERT INTO questions (
      id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status, created_by_user_id
    ) VALUES (
      '${activeId}', '${poolId}', 1, 'Pergunta ativa ${scenario.name}?', 'A', 'B', 'C', 'D',
      0, 'hash-active-${scenario.name}', 'ACTIVE', '${actor}'
    );
    INSERT INTO questions (
      id, pool_id, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status, created_by_user_id, replaces_question_id
    ) VALUES (
      '${draftId}', '${poolId}', 'Pergunta revisada ${scenario.name}?', 'A2', 'B2', 'C2', 'D2',
      1, 'hash-draft-${scenario.name}', 'IN_REVIEW', '${actor}', '${activeId}'
    );
  `);
  const beforePublish = query(scenario, `
    SELECT id, status, active_slot, replaces_question_id FROM questions
     WHERE id IN ('${activeId}', '${draftId}')
  `);
  const draftBefore = beforePublish.find((row) => row.id === draftId);
  const activeBefore = beforePublish.find((row) => row.id === activeId);
  assert(
    beforePublish.length === 2
      && activeBefore?.status === 'ACTIVE' && activeBefore.active_slot === 1
      && draftBefore?.status === 'IN_REVIEW' && draftBefore.active_slot === null
      && draftBefore.replaces_question_id === activeId,
    `${scenario.name}: rascunho de edição não nasceu vinculado à pergunta ativa`,
  );
  // Publicar o rascunho troca o slot no mesmo lote: a ativa some, o rascunho assume.
  executeSql(scenario, `
    UPDATE questions SET status = 'DISABLED', active_slot = NULL,
           resolved_by_user_id = '${actor}', resolved_at = CURRENT_TIMESTAMP
     WHERE id = '${activeId}' AND status = 'ACTIVE';
    UPDATE questions SET status = 'ACTIVE', active_slot = 1,
           resolved_by_user_id = '${actor}', resolved_at = CURRENT_TIMESTAMP
     WHERE id = '${draftId}' AND status = 'IN_REVIEW';
  `);
  const afterPublish = query(scenario, `
    SELECT id, status, active_slot FROM questions WHERE id IN ('${activeId}', '${draftId}')
  `);
  const active = afterPublish.find((row) => row.id === draftId);
  const disabled = afterPublish.find((row) => row.id === activeId);
  assert(
    active?.status === 'ACTIVE' && active.active_slot === 1
      && disabled?.status === 'DISABLED' && disabled.active_slot === null,
    `${scenario.name}: publicação do rascunho não trocou o slot ativo atomicamente`,
  );
  // IN_REVIEW nunca pode ocupar um slot ativo: é o que o sorteio de rodada usa.
  executeSql(scenario, `
    INSERT INTO questions (
      id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status
    ) VALUES (
      'in-review-with-slot-${scenario.name}', '${poolId}', 2, 'x', 'a', 'b', 'c', 'd',
      0, 'hash-bad-slot-${scenario.name}', 'IN_REVIEW'
    )
  `);
  const leakedSlot = query(scenario, `
    SELECT COUNT(*) AS total FROM questions
     WHERE pool_id = '${poolId}' AND status = 'ACTIVE' AND active_slot = 2
  `);
  assert(leakedSlot[0]?.total === 0, `${scenario.name}: pergunta IN_REVIEW apareceu como ACTIVE no slot`);
}

/** @param {MigrationScenario} scenario */
function assertQuestionStatisticsInvariants(scenario) {
  const questionId = `stats-question-${scenario.name}`;
  const poolId = `stats-pool-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO question_pools (id, theme_id, difficulty, active_count) VALUES ('${poolId}', 'theme-x', 'EASY', 1);
    INSERT INTO questions (
      id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status
    ) VALUES (
      '${questionId}', '${poolId}', 1, 'x', 'a', 'b', 'c', 'd', 0, 'hash-stats-${scenario.name}', 'ACTIVE'
    );
    INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id)
    VALUES ('MATCH', 'match-stats-${scenario.name}', 1, 'user-stats-${scenario.name}', '${questionId}');
  `);
  // A chave primária do ledger — não a aplicação — é a barreira definitiva:
  // o mesmo (contexto, rodada, usuário) nunca pode alimentar as estatísticas duas vezes.
  executeSql(scenario, `
    INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id)
    VALUES ('MATCH', 'match-stats-${scenario.name}', 1, 'user-stats-${scenario.name}', 'outra-pergunta-${scenario.name}')
  `, true);
  // Contexto CHALLENGE, outra rodada ou outro usuário continuam livres.
  executeSql(scenario, `
    INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id)
    VALUES ('CHALLENGE', 'match-stats-${scenario.name}', 1, 'user-stats-${scenario.name}', '${questionId}')
  `);
  executeSql(scenario, `
    INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id)
    VALUES ('MATCH', 'match-stats-${scenario.name}', 2, 'user-stats-${scenario.name}', '${questionId}')
  `);
  executeSql(scenario, `
    INSERT INTO question_statistics_ledger (context_kind, context_id, round_number, user_id, question_id)
    VALUES ('MATCH', 'match-stats-${scenario.name}', 1, 'outro-usuario-${scenario.name}', '${questionId}')
  `);
  const entries = query(scenario, `
    SELECT COUNT(*) AS total FROM question_statistics_ledger WHERE context_id = 'match-stats-${scenario.name}'
  `);
  assert(entries[0]?.total === 4, `${scenario.name}: ledger de estatísticas não distinguiu contexto/rodada/usuário corretamente`);
}

/** @param {MigrationScenario} scenario */
function assertAvatarInvariants(scenario) {
  const userId = `avatar-user-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${userId}', 'firebase-${userId}');
    INSERT INTO user_profiles (user_id, public_id, display_name)
    VALUES ('${userId}', '#QGAVATAR${scenario.name.toUpperCase()}', 'Avatar sintético');
    INSERT INTO user_custom_avatars (
      user_id, version, active, content_type, width, height, byte_length, image_data
    ) VALUES ('${userId}', 1, 1, 'image/webp', 256, 256, 1, X'00');
  `);
  executeSql(scenario, `
    UPDATE user_custom_avatars
       SET width = 512
     WHERE user_id = '${userId}'
  `, true);
  executeSql(scenario, `
    UPDATE user_custom_avatars
       SET byte_length = 51201
     WHERE user_id = '${userId}'
  `, true);
  executeSql(scenario, `
    UPDATE user_custom_avatars
       SET version = version + 1,
           active = 0,
           content_type = NULL,
           width = NULL,
           height = NULL,
           byte_length = NULL,
           image_data = NULL
     WHERE user_id = '${userId}'
  `);
  const removed = query(scenario, `
    SELECT version, active, image_data
      FROM user_custom_avatars
     WHERE user_id = '${userId}'
  `);
  assert(
    removed.length === 1
      && removed[0].version === 2
      && removed[0].active === 0
      && removed[0].image_data === null,
    `${scenario.name}: remoção não invalidou a versão nem descartou o BLOB`,
  );
}

/** @param {MigrationScenario} scenario */
function assertArtworkInvariants(scenario) {
  const customThemeId = `theme-migration-validator-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO themes (
      id, category_id, slug, name, description, status, origin, question_shard_id,
      artwork_kind, artwork_version
    ) VALUES (
      '${customThemeId}', '${syntheticCategoryId}', '${customThemeId}',
      'Tema sintético do validador ${scenario.name}', 'Fixture sintética.',
      'PENDING', 'OFFICIAL', 'questions-01', 'CUSTOM', 1
    );
    INSERT INTO theme_artwork_blobs (
      theme_id, version, content_type, width, height, byte_length, image_data
    ) VALUES ('${customThemeId}', 1, 'image/webp', 512, 512, 1, X'00');
  `);

  executeSql(scenario, `
    INSERT INTO themes (
      id, category_id, slug, name, description, status, origin, question_shard_id,
      artwork_kind, artwork_version
    ) VALUES (
      'invalid-icon-${scenario.name}', '${syntheticCategoryId}', 'invalid-icon-${scenario.name}',
      'Tema sintético inválido ${scenario.name}', 'Fixture sintética.',
      'PENDING', 'OFFICIAL', 'questions-01', 'ICON', 0
    )
  `, true);
  executeSql(scenario, `
    INSERT INTO theme_artwork_blobs (
      theme_id, version, content_type, width, height, byte_length, image_data
    ) VALUES ('${syntheticThemeId}', 1, 'image/webp', 512, 512, 1, X'00')
  `, true);
  executeSql(scenario, `
    INSERT INTO theme_artwork_blobs (
      theme_id, version, content_type, width, height, byte_length, image_data
    ) VALUES ('${customThemeId}', 1, 'image/png', 512, 512, 61441, X'00')
  `, true);
  executeSql(scenario, `
    UPDATE themes
       SET artwork_kind = 'ICON', artwork_icon_key = 'science', artwork_version = 2
     WHERE id = '${customThemeId}'
  `, true);

  const protectedState = query(scenario, `
    SELECT t.artwork_kind, t.artwork_version, b.version AS blob_version, COUNT(*) AS blob_count
      FROM themes t
      LEFT JOIN theme_artwork_blobs b ON b.theme_id = t.id
     WHERE t.id = '${customThemeId}'
     GROUP BY t.id
  `);
  assert(
    protectedState.length === 1
      && protectedState[0].artwork_kind === 'CUSTOM'
      && protectedState[0].artwork_version === 1
      && protectedState[0].blob_version === 1
      && protectedState[0].blob_count === 1,
    `${scenario.name}: metadata e BLOB divergiram após escrita inválida`,
  );

  executeSql(scenario, `
    DELETE FROM theme_artwork_blobs WHERE theme_id = '${customThemeId}';
    UPDATE themes
       SET artwork_kind = 'ICON', artwork_icon_key = 'science', artwork_version = 2
     WHERE id = '${customThemeId}' AND artwork_version = 1;
  `);
  const replacementState = query(scenario, `
    SELECT t.artwork_kind, t.artwork_icon_key, t.artwork_version, COUNT(b.theme_id) AS blob_count
      FROM themes t
      LEFT JOIN theme_artwork_blobs b ON b.theme_id = t.id
     WHERE t.id = '${customThemeId}'
     GROUP BY t.id
  `);
  assert(
    replacementState.length === 1
      && replacementState[0].artwork_kind === 'ICON'
      && replacementState[0].artwork_icon_key === 'science'
      && replacementState[0].artwork_version === 2
      && replacementState[0].blob_count === 0,
    `${scenario.name}: substituição explícita não removeu o BLOB de forma atômica`,
  );
}

/** @param {MigrationScenario} scenario */
function assertFriendQueueAlertsSchema(scenario) {
  const alertColumns = query(scenario, 'PRAGMA table_info(friend_queue_alerts)').map(({ name }) => name);
  assert(
    ['recipient_user_id', 'sender_user_id', 'sent_at_ms'].every((column) => alertColumns.includes(column)),
    `${scenario.name}: colunas de friend_queue_alerts ausentes`,
  );
  const probeId = `queue-alert-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${probeId}', 'firebase-${probeId}');
    INSERT INTO friend_queue_alert_preferences (user_id) VALUES ('${probeId}');
  `);
  const preference = query(scenario, `SELECT enabled FROM friend_queue_alert_preferences WHERE user_id = '${probeId}'`);
  assert(preference[0]?.enabled === 0, `${scenario.name}: aviso de amigo na fila precisa nascer desligado`);
  executeSql(scenario, `UPDATE friend_queue_alert_preferences SET enabled = 2 WHERE user_id = '${probeId}';`, true);
  executeSql(scenario, `
    INSERT INTO friend_queue_alerts (recipient_user_id, sender_user_id, sent_at_ms) VALUES ('${probeId}', '${probeId}', 0);
  `, true);
  const plan = query(scenario, `
    EXPLAIN QUERY PLAN SELECT 1 FROM friend_queue_alerts WHERE sender_user_id = 'x' AND sent_at_ms > 1 LIMIT 1
  `);
  assert(
    plan.some(({ detail }) => String(detail).includes('idx_friend_queue_alerts_sender')),
    `${scenario.name}: limite do remetente não usa índice`,
  );
}

/** @param {MigrationScenario} scenario */
function assertPersonalRecordsAndVotesSchema(scenario) {
  const recordColumns = query(scenario, 'PRAGMA table_info(theme_personal_records)').map(({ name }) => name);
  assert(
    ['user_id', 'theme_id', 'mode', 'best_score', 'match_id', 'achieved_at'].every((column) => recordColumns.includes(column)),
    `${scenario.name}: colunas de theme_personal_records ausentes`,
  );
  const voteColumns = query(scenario, 'PRAGMA table_info(theme_suggestion_votes)').map(({ name }) => name);
  assert(
    ['suggestion_id', 'user_id', 'created_at'].every((column) => voteColumns.includes(column)),
    `${scenario.name}: colunas de theme_suggestion_votes ausentes`,
  );
  const suggestionId = `suggestion-${scenario.name}`;
  const voterId = `voter-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${voterId}', 'firebase-${voterId}');
    INSERT INTO theme_suggestions (id, name) VALUES ('${suggestionId}', 'Tema candidato');
    INSERT INTO theme_suggestion_votes (suggestion_id, user_id) VALUES ('${suggestionId}', '${voterId}');
  `);
  executeSql(scenario, `
    INSERT INTO theme_suggestion_votes (suggestion_id, user_id) VALUES ('${suggestionId}', '${voterId}');
  `, true);
  executeSql(scenario, `INSERT INTO theme_suggestions (id, name) VALUES ('${suggestionId}-short', 'x');`, true);
  executeSql(scenario, `
    INSERT INTO theme_personal_records (user_id, theme_id, mode, best_score, match_id)
    VALUES ('${voterId}', '${syntheticThemeId}', 'CASUAL', 0, 'probe');
  `, true);
  executeSql(scenario, `
    DELETE FROM theme_suggestions WHERE id = '${suggestionId}';
    DELETE FROM users WHERE id = '${voterId}';
  `);
  const orphanVotes = query(scenario, `SELECT 1 FROM theme_suggestion_votes WHERE suggestion_id = '${suggestionId}'`);
  assert(orphanVotes.length === 0, `${scenario.name}: voto não foi removido junto com o tema candidato`);
}

/** Partidas antes da 0017: só o melhor placar ao vivo concluído vira recorde. @param {MigrationScenario} scenario */
function seedPersonalRecordFixture(scenario) {
  const userId = `record-${scenario.name}`;
  const match = (id, status, kind, score) => `
    INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id, finished_at)
    VALUES ('${id}', '${syntheticThemeId}', 'MEDIUM', 'CASUAL', '${kind}', '${status}', 'questions-01', '2026-09-0${score % 9 + 1}');
    INSERT INTO match_players (match_id, user_id, seat, score) VALUES ('${id}', '${userId}', 1, ${score});
  `;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${userId}', 'firebase-${userId}');
    ${match(`${userId}-low`, 'FINISHED', 'MATCHMAKING', 40)}
    ${match(`${userId}-best`, 'FINISHED', 'DIRECT_LIVE', 70)}
    ${match(`${userId}-void`, 'VOID', 'MATCHMAKING', 99)}
  `);
  return userId;
}

/** @param {MigrationScenario} scenario @param {string} userId */
function assertPersonalRecordBackfill(scenario, userId) {
  const records = query(scenario, `
    SELECT mode, best_score, match_id FROM theme_personal_records WHERE user_id = '${userId}'
  `);
  assert(
    records.length === 1
      && records[0].mode === 'CASUAL'
      && records[0].best_score === 70
      && records[0].match_id === `${userId}-best`,
    `${scenario.name}: backfill de recorde pessoal não escolheu a melhor partida concluída`,
  );
}

/** @param {MigrationScenario} scenario @returns {string} */
function seedPoolDiscoveryFixture(scenario) {
  const userId = `pool-discovery-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO users (id, firebase_uid) VALUES ('${userId}', 'firebase-${userId}');
    INSERT INTO user_pool_states (user_id, pool_id, state_blob) VALUES
      ('${userId}', 'theme-x:easy', X'0200'),
      ('${userId}', 'theme-x:pool', X'0200');
  `);
  return userId;
}

/** @param {MigrationScenario} scenario @param {string} userId */
function assertPoolDiscoveryReset(scenario, userId) {
  const remaining = query(scenario, `
    SELECT pool_id FROM user_pool_states WHERE user_id = '${userId}' ORDER BY pool_id
  `);
  assert(
    remaining.length === 1 && remaining[0].pool_id === 'theme-x:pool',
    `${scenario.name}: reset de descoberta não limpou o pool_id antigo (ou removeu o novo por engano)`,
  );
}

/** @param {MigrationScenario} scenario */
async function assertRollback(scenario) {
  const rollbackMigrationName = '0008_rollback_probe.sql';
  await writeFile(join(scenario.migrationsDirectory, rollbackMigrationName), `
    CREATE TABLE theme_artwork_rollback_probe (id INTEGER PRIMARY KEY);
    INSERT INTO theme_artwork_rollback_probe (id) VALUES (1);
    SELECT id FROM deliberately_missing_rollback_table;
  `, 'utf8');
  applyMigrations(scenario, true);
  const residue = query(scenario, `
    SELECT name FROM sqlite_master WHERE name = 'theme_artwork_rollback_probe'
    UNION ALL
    SELECT name FROM d1_migrations WHERE name = '${rollbackMigrationName}'
  `);
  assert(residue.length === 0, `${scenario.name}: migration com erro deixou schema ou histórico parcial`);
}

/** @param {MigrationScenario} scenario @param {string} [expectedLastMigration] */
function assertFinalQuestionDataset(scenario, expectedLastMigration = '0006_question_statistics_retry.sql') {
  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.at(-1)?.name === expectedLastMigration,
    `${scenario.name}: ${expectedLastMigration} não foi registrada como última migration de Questions`,
  );
  const pool = query(scenario, `
    SELECT active_count, version, migration_status
      FROM question_pools
     WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
  `);
  assert(
    pool.length === 1
      && pool[0].active_count === 250
      && pool[0].version === 1
      && pool[0].migration_status === 'READY',
    `${scenario.name}: pool sintético não terminou READY com 250 perguntas`,
  );
  const questions = query(scenario, `
    SELECT COUNT(*) AS total,
           COUNT(DISTINCT active_slot) AS distinct_slots,
           MIN(active_slot) AS min_slot,
           MAX(active_slot) AS max_slot,
           SUM(CASE WHEN editorial_flags_json = '["SYNTHETIC_SMOKE_TEST"]' THEN 1 ELSE 0 END) AS flagged,
           SUM(CASE WHEN image_key IS NULL AND image_bytes IS NULL AND image_license IS NULL THEN 1 ELSE 0 END) AS without_images,
           SUM(CASE WHEN prompt LIKE '[SYNTHETIC_SMOKE_TEST %/250]%' THEN 1 ELSE 0 END) AS marked_prompts
      FROM questions
     WHERE pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
  `)[0];
  assert(
    questions?.total === 250
      && questions.distinct_slots === 250
      && questions.min_slot === 1
      && questions.max_slot === 250
      && questions.flagged === 250
      && questions.without_images === 250
      && questions.marked_prompts === 250,
    `${scenario.name}: perguntas sintéticas não são 250 slots densos, marcados e sem mídia`,
  );
  const sources = query(scenario, `
    SELECT COUNT(*) AS total
      FROM question_sources s
      JOIN questions q ON q.id = s.question_id
     WHERE q.pool_id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
  `);
  assert(sources[0]?.total === 0, `${scenario.name}: dataset sintético recebeu fontes editoriais`);
}

/** @param {MigrationScenario} scenario */
function assertUnifiedQuestionPoolInvariants(scenario) {
  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.some(({ name }) => name === '0007_unify_question_pools.sql'),
    `${scenario.name}: 0007 de unificação de pools não foi registrada`,
  );
  const oldPool = query(scenario, `
    SELECT 1 FROM question_pools WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
  `);
  assert(oldPool.length === 0, `${scenario.name}: pool sintético antigo por dificuldade sobreviveu à unificação`);
  const pool = query(scenario, `
    SELECT active_count, migration_status
      FROM question_pools
     WHERE id = '${syntheticThemeId}:pool'
  `);
  assert(
    pool.length === 1 && pool[0].active_count === 250 && pool[0].migration_status === 'READY',
    `${scenario.name}: pool unificado do tema sintético não terminou READY com 250 perguntas`,
  );
  const questions = query(scenario, `
    SELECT COUNT(*) AS total, COUNT(DISTINCT active_slot) AS distinct_slots,
           MIN(active_slot) AS min_slot, MAX(active_slot) AS max_slot
      FROM questions
     WHERE pool_id = '${syntheticThemeId}:pool' AND status = 'ACTIVE'
  `)[0];
  assert(
    questions?.total === 250 && questions.distinct_slots === 250 && questions.min_slot === 1 && questions.max_slot === 250,
    `${scenario.name}: unificação do pool sintético não manteve 250 slots densos únicos`,
  );
}

/** @param {MigrationScenario} scenario */
function assertQuestionExportIndex(scenario) {
  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.some(({ name }) => name === '0008_question_export_index.sql'),
    `${scenario.name}: 0008 de índice da exportação não foi registrada`,
  );
  const index = query(scenario, `
    SELECT 1 FROM sqlite_master
     WHERE type = 'index' AND name = 'idx_questions_pool_id'
  `);
  assert(index.length === 1, `${scenario.name}: índice de paginação da exportação ausente`);
}

/** @param {MigrationScenario} scenario */
function assertQuestionImageKeyIndex(scenario) {
  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.at(-1)?.name === '0009_question_image_key_index.sql',
    `${scenario.name}: 0009 de índice de foto não foi registrada como última migration de Questions`,
  );
  const plan = query(scenario, "EXPLAIN QUERY PLAN SELECT 1 FROM questions WHERE image_key = 'questions/x/v1.webp' LIMIT 1");
  assert(
    plan.some(({ detail }) => String(detail).includes('idx_questions_image_key')),
    `${scenario.name}: consulta por image_key não usa o índice parcial`,
  );
}

/**
 * Semeia um tema com os três pools antigos por dificuldade (duas ativas em
 * EASY, uma ativa em MEDIUM, um rascunho IN_REVIEW em HARD) para provar que a
 * 0007 soma as ativas de verdade, reindexa 1..N sem colidir e repontea até o
 * rascunho — não só o dataset sintético, que sempre teve um único pool.
 * @param {MigrationScenario} scenario @returns {string}
 */
function seedQuestionPoolMergeFixture(scenario) {
  const themeId = `pool-merge-${scenario.name}`;
  executeSql(scenario, `
    INSERT INTO question_pools (id, theme_id, difficulty, active_count, version) VALUES
      ('${themeId}:easy', '${themeId}', 'EASY', 2, 1),
      ('${themeId}:medium', '${themeId}', 'MEDIUM', 1, 1),
      ('${themeId}:hard', '${themeId}', 'HARD', 0, 1);
    INSERT INTO questions (
      id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status
    ) VALUES
      ('${themeId}-easy-1', '${themeId}:easy', 1, 'x', 'a', 'b', 'c', 'd', 0, 'hash-${themeId}-easy-1', 'ACTIVE'),
      ('${themeId}-easy-2', '${themeId}:easy', 2, 'x', 'a', 'b', 'c', 'd', 0, 'hash-${themeId}-easy-2', 'ACTIVE'),
      ('${themeId}-medium-1', '${themeId}:medium', 1, 'x', 'a', 'b', 'c', 'd', 0, 'hash-${themeId}-medium-1', 'ACTIVE');
    INSERT INTO pool_slot_migrations (id, pool_id, from_version, to_version, slot_map_blob, status)
      VALUES ('${themeId}-stale-slot-map', '${themeId}:hard', 1, 2, X'00', 'DONE');
    INSERT INTO questions (
      id, pool_id, prompt, option_a, option_b, option_c, option_d,
      correct_option, content_hash, status
    ) VALUES
      ('${themeId}-draft', '${themeId}:hard', 'x', 'a', 'b', 'c', 'd', 0, 'hash-${themeId}-draft', 'IN_REVIEW');
  `);
  return themeId;
}

/** @param {MigrationScenario} scenario @param {string} themeId */
function assertQuestionPoolMergeInvariants(scenario, themeId) {
  const oldPools = query(scenario, `
    SELECT id FROM question_pools WHERE id IN ('${themeId}:easy', '${themeId}:medium', '${themeId}:hard')
  `);
  assert(oldPools.length === 0, `${scenario.name}: pools antigos por dificuldade de ${themeId} sobreviveram à unificação`);
  const merged = query(scenario, `SELECT active_count FROM question_pools WHERE id = '${themeId}:pool'`);
  assert(
    merged.length === 1 && merged[0].active_count === 3,
    `${scenario.name}: pool unificado de ${themeId} não somou as 3 perguntas ativas dos pools antigos`,
  );
  const activeSlots = query(scenario, `
    SELECT active_slot FROM questions
     WHERE pool_id = '${themeId}:pool' AND status = 'ACTIVE'
     ORDER BY active_slot
  `);
  assert(
    activeSlots.length === 3 && activeSlots.every((row, index) => row.active_slot === index + 1),
    `${scenario.name}: unificação de ${themeId} não reindexou os slots ativos como 1..3 densos`,
  );
  const draft = query(scenario, `SELECT pool_id, active_slot, status FROM questions WHERE id = '${themeId}-draft'`);
  assert(
    draft.length === 1 && draft[0].pool_id === `${themeId}:pool` && draft[0].active_slot === null && draft[0].status === 'IN_REVIEW',
    `${scenario.name}: rascunho IN_REVIEW não foi repontado para o pool unificado sem ganhar slot`,
  );
  const staleSlotMaps = query(scenario, `SELECT 1 FROM pool_slot_migrations WHERE id = '${themeId}-stale-slot-map'`);
  assert(
    staleSlotMaps.length === 0,
    `${scenario.name}: mapa de slots antigo sobreviveu à renumeração do pool único`,
  );
}

/** @param {string} sourceDirectory @param {string[]} migrationNames */
async function assertRemoteParser(sourceDirectory, migrationNames) {
  for (const migrationName of migrationNames) {
    const sql = await readFile(join(sourceDirectory, migrationName), 'utf8');
    const sqlWithoutComments = sql.replaceAll(/--[^\n]*/g, '').replaceAll(/\/\*[\s\S]*?\*\//g, '');
    assert(!sql.includes('\r'), `${migrationName}: use apenas LF; SQL remoto não deve conter CRLF`);
    assert(
      !/\bCREATE\s+TRIGGER\b/i.test(sqlWithoutComments),
      `${migrationName}: CREATE TRIGGER é proibido nas migrations D1 remotas; use constraints e transações`,
    );
    const trackingStatement = `INSERT INTO d1_migrations (name) VALUES ('${migrationName.replaceAll("'", "''")}');`;
    const statements = splitSqlQuery(`${sql}\n${trackingStatement}`);
    assert(statements.length >= 2, `${migrationName}: parser do Wrangler não encontrou SQL completo + tracking`);
    assert(
      statements.at(-1)?.includes('INSERT INTO d1_migrations'),
      `${migrationName}: parser do Wrangler absorveu o tracking da migration no statement anterior`,
    );
  }
}

try {
  const migrationNames = (await readdir(coreSourceMigrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const questionMigrationNames = (await readdir(questionSourceMigrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  assert(migrationNames.includes('0004_theme_artwork.sql'), 'Migration 0004_theme_artwork.sql ausente');
  assert(migrationNames.includes('0005_user_custom_avatars.sql'), 'Migration 0005_user_custom_avatars.sql ausente');
  assert(migrationNames.includes('0006_expand_synthetic_smoke_test.sql'), 'Migration Core 0006 ausente');
  assert(migrationNames.includes('0007_social_foundation.sql'), 'Migration Core 0007 social ausente');
  assert(migrationNames.includes('0008_challenges_and_mutes.sql'), 'Migration Core 0008 de desafios ausente');
  assert(
    migrationNames.includes('0009_challenge_pair_limits_by_kind.sql'),
    'Migration Core 0009 de limite por tipo ausente',
  );
  assert(migrationNames.includes('0010_question_reports.sql'), 'Migration Core 0010 de denúncias ausente');
  assert(migrationNames.includes('0011_question_report_views.sql'), 'Migration Core 0011 de recibos de denúncia ausente');
  assert(
    migrationNames.includes('0012_editorial_missions_streak.sql'),
    'Migration Core 0012 do pipeline editorial/missões/streak ausente',
  );
  assert(
    migrationNames.includes('0013_challenge_completion_ledger.sql'),
    'Migration Core 0013 do ledger de conclusão de desafio ausente',
  );
  assert(
    migrationNames.includes('0014_challenge_progression_retry.sql'),
    'Migration Core 0014 de retomada da progressão ausente',
  );
  assert(
    migrationNames.includes('0015_admin_user_search_index.sql'),
    'Migration Core 0015 do índice de busca de usuários ausente',
  );
  assert(
    migrationNames.includes('0016_reset_stale_pool_discovery.sql'),
    'Migration Core 0016 de reset de descoberta de pool antigo ausente',
  );
  assert(
    migrationNames.includes('0017_personal_records_and_theme_votes.sql'),
    'Migration Core 0017 de recordes pessoais e votação de temas ausente',
  );
  assert(
    migrationNames.includes('0018_friend_queue_alerts.sql'),
    'Migration Core 0018 de avisos de amigo na fila ausente',
  );
  assert(questionMigrationNames.includes('0003_expand_synthetic_smoke_test.sql'), 'Migration Questions 0003 ausente');
  assert(
    questionMigrationNames.includes('0004_question_editorial_versioning.sql'),
    'Migration Questions 0004 de versionamento editorial ausente',
  );
  assert(
    questionMigrationNames.includes('0005_question_statistics_ledger.sql'),
    'Migration Questions 0005 do ledger de estatísticas ausente',
  );
  assert(
    questionMigrationNames.includes('0006_question_statistics_retry.sql'),
    'Migration Questions 0006 de retomada das estatísticas ausente',
  );
  assert(
    questionMigrationNames.includes('0007_unify_question_pools.sql'),
    'Migration Questions 0007 de unificação de pools ausente',
  );
  assert(
    questionMigrationNames.includes('0008_question_export_index.sql'),
    'Migration Questions 0008 do índice de exportação ausente',
  );
  assert(
    questionMigrationNames.includes('0009_question_image_key_index.sql'),
    'Migration Questions 0009 do índice de foto ausente',
  );

  await assertRemoteParser(coreSourceMigrationsDirectory, migrationNames);
  await assertRemoteParser(questionSourceMigrationsDirectory, questionMigrationNames);

  const emptyDatabase = await createScenario('empty', migrationNames);
  console.log('Validando migrations D1 em banco vazio...');
  applyMigrations(emptyDatabase);
  assertFinalSchema(emptyDatabase);
  assertArtworkInvariants(emptyDatabase);
  assertAvatarInvariants(emptyDatabase);
  assertSocialInvariants(emptyDatabase);
  assertChallengeInvariants(emptyDatabase);
  assertChallengeCompletionLedgerInvariants(emptyDatabase);
  assertReportInvariants(emptyDatabase);
  assertReportViewInvariants(emptyDatabase);
  assertEditorialInvariants(emptyDatabase);

  const upgradeDatabase = await createScenario(
    'upgrade-0003',
    migrationNames.filter((name) => ![
      '0004_theme_artwork.sql',
      '0005_user_custom_avatars.sql',
      '0006_expand_synthetic_smoke_test.sql',
      '0007_social_foundation.sql',
      '0008_challenges_and_mutes.sql',
      '0009_challenge_pair_limits_by_kind.sql',
      '0010_question_reports.sql',
      '0011_question_report_views.sql',
      '0012_editorial_missions_streak.sql',
      '0013_challenge_completion_ledger.sql',
      '0014_challenge_progression_retry.sql',
      '0015_admin_user_search_index.sql',
      '0016_reset_stale_pool_discovery.sql',
      '0017_personal_records_and_theme_votes.sql',
      '0018_friend_queue_alerts.sql',
    ].includes(name)),
  );
  console.log('Validando upgrade D1 exato de 0003 para 0004...');
  applyMigrations(upgradeDatabase);
  const beforeUpgrade = query(upgradeDatabase, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(beforeUpgrade.at(-1)?.name === '0003_synthetic_smoke_test.sql', 'upgrade-0003: estado inicial não terminou na 0003');
  assert(
    !query(upgradeDatabase, 'PRAGMA table_info(themes)').some(({ name }) => name === 'artwork_kind'),
    'upgrade-0003: coluna da 0004 já existia antes do upgrade',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0004_theme_artwork.sql'),
    join(upgradeDatabase.migrationsDirectory, '0004_theme_artwork.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertArtworkInvariants(upgradeDatabase);
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'user_custom_avatars'").length,
    'upgrade-0003: tabela de avatar já existia antes da 0005',
  );
  console.log('Validando upgrade D1 atual exato de 0004 para 0005...');
  await copyFile(
    join(coreSourceMigrationsDirectory, '0005_user_custom_avatars.sql'),
    join(upgradeDatabase.migrationsDirectory, '0005_user_custom_avatars.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertAvatarInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0005 para 0006...');
  await copyFile(
    join(coreSourceMigrationsDirectory, '0006_expand_synthetic_smoke_test.sql'),
    join(upgradeDatabase.migrationsDirectory, '0006_expand_synthetic_smoke_test.sql'),
  );
  applyMigrations(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0006 para 0007 Social Foundation...');
  await copyFile(
    join(coreSourceMigrationsDirectory, '0007_social_foundation.sql'),
    join(upgradeDatabase.migrationsDirectory, '0007_social_foundation.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertSocialInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0007 para 0008 Desafios entre amigos...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'friendship_mutes'").length,
    'upgrade-0003: tabela de silenciamento já existia antes da 0008',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0008_challenges_and_mutes.sql'),
    join(upgradeDatabase.migrationsDirectory, '0008_challenges_and_mutes.sql'),
  );
  applyMigrations(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0008 para 0009 limite por tipo...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'idx_challenges_live_pair_async'").length,
    'upgrade-0003: índice por tipo já existia antes da 0009',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0009_challenge_pair_limits_by_kind.sql'),
    join(upgradeDatabase.migrationsDirectory, '0009_challenge_pair_limits_by_kind.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertChallengeInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0009 para 0010 denúncias de pergunta...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'question_reports'").length,
    'upgrade-0003: tabela de denúncias já existia antes da 0010',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0010_question_reports.sql'),
    join(upgradeDatabase.migrationsDirectory, '0010_question_reports.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertReportInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0010 para 0011 recibos de visualização...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'question_report_views'").length,
    'upgrade-0010: tabela de recibos já existia antes da 0011',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0011_question_report_views.sql'),
    join(upgradeDatabase.migrationsDirectory, '0011_question_report_views.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertReportViewInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0011 para 0012 pipeline editorial/missões/streak...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'user_daily_missions'").length,
    'upgrade-0003: tabela de missões já existia antes da 0012',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0012_editorial_missions_streak.sql'),
    join(upgradeDatabase.migrationsDirectory, '0012_editorial_missions_streak.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertEditorialInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0012 para 0013 ledger de conclusão de desafio...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'challenge_xp_ledger'").length,
    'upgrade-0003: ledger de XP já existia antes da 0013',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0013_challenge_completion_ledger.sql'),
    join(upgradeDatabase.migrationsDirectory, '0013_challenge_completion_ledger.sql'),
  );
  applyMigrations(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0013 para 0014 retomada de progressão...');
  await copyFile(
    join(coreSourceMigrationsDirectory, '0014_challenge_progression_retry.sql'),
    join(upgradeDatabase.migrationsDirectory, '0014_challenge_progression_retry.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertChallengeCompletionLedgerInvariants(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0014 para 0015 índice de busca de usuários...');
  assert(
    !query(upgradeDatabase, "SELECT name FROM sqlite_master WHERE name = 'idx_users_admin_listing'").length,
    'upgrade-0003: índice de usuários já existia antes da 0015',
  );
  await copyFile(
    join(coreSourceMigrationsDirectory, '0015_admin_user_search_index.sql'),
    join(upgradeDatabase.migrationsDirectory, '0015_admin_user_search_index.sql'),
  );
  applyMigrations(upgradeDatabase);
  console.log('Validando upgrade D1 atual exato de 0015 para 0016 reset de descoberta de pool antigo...');
  const discoveryUserId = seedPoolDiscoveryFixture(upgradeDatabase);
  await copyFile(
    join(coreSourceMigrationsDirectory, '0016_reset_stale_pool_discovery.sql'),
    join(upgradeDatabase.migrationsDirectory, '0016_reset_stale_pool_discovery.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertPoolDiscoveryReset(upgradeDatabase, discoveryUserId);
  console.log('Validando upgrade D1 atual exato de 0016 para 0017 recordes pessoais e votação de temas...');
  const recordUserId = seedPersonalRecordFixture(upgradeDatabase);
  await copyFile(
    join(coreSourceMigrationsDirectory, '0017_personal_records_and_theme_votes.sql'),
    join(upgradeDatabase.migrationsDirectory, '0017_personal_records_and_theme_votes.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertPersonalRecordBackfill(upgradeDatabase, recordUserId);
  console.log('Validando upgrade D1 atual exato de 0017 para 0018 avisos de amigo na fila...');
  await copyFile(
    join(coreSourceMigrationsDirectory, '0018_friend_queue_alerts.sql'),
    join(upgradeDatabase.migrationsDirectory, '0018_friend_queue_alerts.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertFinalSchema(upgradeDatabase);
  console.log('Validando rollback transacional de migration com erro...');
  await assertRollback(upgradeDatabase);

  const emptyQuestions = await createScenario('questions-empty', questionMigrationNames, {
    binding: 'QUESTIONS_DB',
    databaseName: questionDatabaseName,
    migrationsSubdirectory: 'questions',
    sourceDirectory: questionSourceMigrationsDirectory,
  });
  console.log('Validando migrations Questions D1 em banco vazio...');
  applyMigrations(emptyQuestions);
  assertUnifiedQuestionPoolInvariants(emptyQuestions);
  assertQuestionExportIndex(emptyQuestions);
  assertQuestionImageKeyIndex(emptyQuestions);
  assertQuestionVersioningInvariants(emptyQuestions);
  assertQuestionStatisticsInvariants(emptyQuestions);

  const upgradeQuestions = await createScenario(
    'questions-upgrade-0002',
    questionMigrationNames.filter((name) => ![
      '0003_expand_synthetic_smoke_test.sql',
      '0004_question_editorial_versioning.sql',
      '0005_question_statistics_ledger.sql',
      '0006_question_statistics_retry.sql',
      '0007_unify_question_pools.sql',
      '0008_question_export_index.sql',
      '0009_question_image_key_index.sql',
    ].includes(name)),
    {
      binding: 'QUESTIONS_DB',
      databaseName: questionDatabaseName,
      migrationsSubdirectory: 'questions',
      sourceDirectory: questionSourceMigrationsDirectory,
    },
  );
  console.log('Validando upgrade Questions D1 exato de 0002 para 0003...');
  applyMigrations(upgradeQuestions);
  const beforeQuestionUpgrade = query(upgradeQuestions, `
    SELECT active_count
      FROM question_pools
     WHERE id = 'pool-synthetic-smoke-test-multiplayer-easy-20260811'
  `);
  assert(beforeQuestionUpgrade[0]?.active_count === 30, 'questions-upgrade-0002: estado inicial não possui 30 perguntas');
  await copyFile(
    join(questionSourceMigrationsDirectory, '0003_expand_synthetic_smoke_test.sql'),
    join(upgradeQuestions.migrationsDirectory, '0003_expand_synthetic_smoke_test.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertFinalQuestionDataset(upgradeQuestions, '0003_expand_synthetic_smoke_test.sql');
  console.log('Validando upgrade Questions D1 exato de 0003 para 0004 versionamento editorial...');
  assert(
    !query(upgradeQuestions, 'PRAGMA table_info(questions)').some(({ name }) => name === 'replaces_question_id'),
    'questions-upgrade-0002: coluna de versionamento já existia antes da 0004',
  );
  await copyFile(
    join(questionSourceMigrationsDirectory, '0004_question_editorial_versioning.sql'),
    join(upgradeQuestions.migrationsDirectory, '0004_question_editorial_versioning.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertFinalQuestionDataset(upgradeQuestions, '0004_question_editorial_versioning.sql');
  assertQuestionVersioningInvariants(upgradeQuestions);
  console.log('Validando upgrade Questions D1 exato de 0004 para 0005 ledger de estatísticas...');
  assert(
    !query(upgradeQuestions, "SELECT name FROM sqlite_master WHERE name = 'question_statistics_ledger'").length,
    'questions-upgrade-0002: ledger de estatísticas já existia antes da 0005',
  );
  await copyFile(
    join(questionSourceMigrationsDirectory, '0005_question_statistics_ledger.sql'),
    join(upgradeQuestions.migrationsDirectory, '0005_question_statistics_ledger.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertFinalQuestionDataset(upgradeQuestions, '0005_question_statistics_ledger.sql');
  console.log('Validando upgrade Questions D1 exato de 0005 para 0006 retomada de estatísticas...');
  await copyFile(
    join(questionSourceMigrationsDirectory, '0006_question_statistics_retry.sql'),
    join(upgradeQuestions.migrationsDirectory, '0006_question_statistics_retry.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertFinalQuestionDataset(upgradeQuestions, '0006_question_statistics_retry.sql');
  assertQuestionStatisticsInvariants(upgradeQuestions);
  console.log('Validando upgrade Questions D1 exato de 0006 para 0007 pool único por tema...');
  const mergeThemeId = seedQuestionPoolMergeFixture(upgradeQuestions);
  await copyFile(
    join(questionSourceMigrationsDirectory, '0007_unify_question_pools.sql'),
    join(upgradeQuestions.migrationsDirectory, '0007_unify_question_pools.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertUnifiedQuestionPoolInvariants(upgradeQuestions);
  assertQuestionPoolMergeInvariants(upgradeQuestions, mergeThemeId);
  console.log('Validando upgrade Questions D1 exato de 0007 para 0008 índice de exportação...');
  await copyFile(
    join(questionSourceMigrationsDirectory, '0008_question_export_index.sql'),
    join(upgradeQuestions.migrationsDirectory, '0008_question_export_index.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertQuestionExportIndex(upgradeQuestions);
  console.log('Validando upgrade Questions D1 exato de 0008 para 0009 índice de foto...');
  await copyFile(
    join(questionSourceMigrationsDirectory, '0009_question_image_key_index.sql'),
    join(upgradeQuestions.migrationsDirectory, '0009_question_image_key_index.sql'),
  );
  applyMigrations(upgradeQuestions);
  assertQuestionImageKeyIndex(upgradeQuestions);

  console.log('Migrations D1 aprovadas: parser Wrangler, bancos vazios, upgrades Core 0003→0004→0005→0006→0007→0008→0009→0010→0011→0012→0013→0014→0015→0016→0017→0018 e Questions 0002→0003→0004→0005→0006→0007→0008→0009, invariantes sociais, de desafio, de ledger de conclusão, de denúncia, editoriais, pool único por tema, índices de exportação e de foto, rollback e schemas finais.');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
