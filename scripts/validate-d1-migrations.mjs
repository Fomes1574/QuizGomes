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
     WHERE name IN ('theme_artwork_blobs', 'themes_artwork_parent_key', 'user_custom_avatars')
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
  assert(!schemaObjects.some(({ type }) => type === 'trigger'), `${scenario.name}: migration criou trigger remoto frágil`);

  const themeColumns = query(scenario, 'PRAGMA table_info(themes)');
  for (const columnName of ['artwork_icon_key', 'artwork_version', 'artwork_kind']) {
    assert(themeColumns.some(({ name }) => name === columnName), `${scenario.name}: coluna ${columnName} ausente`);
  }

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
    appliedMigrations.at(-1)?.name === '0006_expand_synthetic_smoke_test.sql',
    `${scenario.name}: 0006 não foi registrada como última migration`,
  );
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
async function assertRollback(scenario) {
  const rollbackMigrationName = '0007_rollback_probe.sql';
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

/** @param {MigrationScenario} scenario */
function assertFinalQuestionDataset(scenario) {
  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.at(-1)?.name === '0003_expand_synthetic_smoke_test.sql',
    `${scenario.name}: 0003 de Questions não foi registrada como última migration`,
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
  assert(questionMigrationNames.includes('0003_expand_synthetic_smoke_test.sql'), 'Migration Questions 0003 ausente');

  await assertRemoteParser(coreSourceMigrationsDirectory, migrationNames);
  await assertRemoteParser(questionSourceMigrationsDirectory, questionMigrationNames);

  const emptyDatabase = await createScenario('empty', migrationNames);
  console.log('Validando migrations D1 em banco vazio...');
  applyMigrations(emptyDatabase);
  assertFinalSchema(emptyDatabase);
  assertArtworkInvariants(emptyDatabase);
  assertAvatarInvariants(emptyDatabase);

  const upgradeDatabase = await createScenario(
    'upgrade-0003',
    migrationNames.filter((name) => ![
      '0004_theme_artwork.sql',
      '0005_user_custom_avatars.sql',
      '0006_expand_synthetic_smoke_test.sql',
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
  assertFinalQuestionDataset(emptyQuestions);

  const upgradeQuestions = await createScenario(
    'questions-upgrade-0002',
    questionMigrationNames.filter((name) => name !== '0003_expand_synthetic_smoke_test.sql'),
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
  assertFinalQuestionDataset(upgradeQuestions);

  console.log('Migrations D1 aprovadas: parser Wrangler, bancos vazios, upgrades Core 0003→0004→0005→0006 e Questions 0002→0003, invariantes, rollback e schemas finais.');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
