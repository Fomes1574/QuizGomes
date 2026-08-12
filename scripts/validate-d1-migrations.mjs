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
const sourceMigrationsDirectory = join(repositoryRoot, 'apps/worker/migrations/core');
const wranglerEntryPoint = join(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = 'quiz-gomes-core';
const syntheticCategoryId = 'category-synthetic-smoke-test-20260811';
const syntheticThemeId = 'theme-synthetic-smoke-test-multiplayer-20260811';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'quiz-gomes-d1-migrations-'));

/**
 * @typedef {{
 *   configPath: string,
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
    'd1', 'migrations', 'apply', databaseName,
    '--local',
    '--persist-to', scenario.persistenceDirectory,
    '--config', scenario.configPath,
  ], expectFailure);
}

/** @param {MigrationScenario} scenario @param {string} sql @param {boolean} [expectFailure] */
function executeSql(scenario, sql, expectFailure = false) {
  return runWrangler(scenario, [
    'd1', 'execute', databaseName,
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
    'd1', 'execute', databaseName,
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

/** @param {string} name @param {string[]} migrationNames @returns {Promise<MigrationScenario>} */
async function createScenario(name, migrationNames) {
  const directory = join(temporaryRoot, name);
  const migrationsDirectory = join(directory, 'migrations/core');
  const persistenceDirectory = join(directory, 'state');
  const configPath = join(directory, 'wrangler.jsonc');
  await mkdir(migrationsDirectory, { recursive: true });
  await Promise.all(migrationNames.map((migrationName) => copyFile(
    join(sourceMigrationsDirectory, migrationName),
    join(migrationsDirectory, migrationName),
  )));
  await writeFile(configPath, `${JSON.stringify({
    compatibility_date: '2026-08-10',
    d1_databases: [{
      binding: 'CORE_DB',
      database_id: '00000000-0000-0000-0000-000000000001',
      database_name: databaseName,
      migrations_dir: 'migrations/core',
    }],
    name: `quiz-gomes-migration-validator-${name}`,
  }, null, 2)}\n`, 'utf8');
  return { configPath, directory, migrationsDirectory, name, persistenceDirectory };
}

/** @param {MigrationScenario} scenario */
function assertFinalSchema(scenario) {
  const schemaObjects = query(scenario, `
    SELECT name, type
      FROM sqlite_master
     WHERE name IN ('theme_artwork_blobs', 'themes_artwork_parent_key')
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

  const appliedMigrations = query(scenario, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(
    appliedMigrations.at(-1)?.name === '0004_theme_artwork.sql',
    `${scenario.name}: 0004 não foi registrada como última migration`,
  );
  const upgradedTheme = query(scenario, `
    SELECT artwork_kind, artwork_icon_key, artwork_version
      FROM themes
     WHERE id = '${syntheticThemeId}'
  `);
  assert(
    upgradedTheme.length === 1
      && upgradedTheme[0].artwork_kind === 'NONE'
      && upgradedTheme[0].artwork_icon_key === null
      && upgradedTheme[0].artwork_version === 0,
    `${scenario.name}: defaults da 0004 não preservaram o tema vindo da 0003`,
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
  const rollbackMigrationName = '0005_rollback_probe.sql';
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

try {
  const migrationNames = (await readdir(sourceMigrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  assert(migrationNames.includes('0004_theme_artwork.sql'), 'Migration 0004_theme_artwork.sql ausente');

  for (const migrationName of migrationNames) {
    const sql = await readFile(join(sourceMigrationsDirectory, migrationName), 'utf8');
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

  const emptyDatabase = await createScenario('empty', migrationNames);
  console.log('Validando migrations D1 em banco vazio...');
  applyMigrations(emptyDatabase);
  assertFinalSchema(emptyDatabase);
  assertArtworkInvariants(emptyDatabase);

  const upgradeDatabase = await createScenario('upgrade-0003', migrationNames.filter((name) => name !== '0004_theme_artwork.sql'));
  console.log('Validando upgrade D1 exato de 0003 para 0004...');
  applyMigrations(upgradeDatabase);
  const beforeUpgrade = query(upgradeDatabase, 'SELECT name FROM d1_migrations ORDER BY id');
  assert(beforeUpgrade.at(-1)?.name === '0003_synthetic_smoke_test.sql', 'upgrade-0003: estado inicial não terminou na 0003');
  assert(
    !query(upgradeDatabase, 'PRAGMA table_info(themes)').some(({ name }) => name === 'artwork_kind'),
    'upgrade-0003: coluna da 0004 já existia antes do upgrade',
  );
  await copyFile(
    join(sourceMigrationsDirectory, '0004_theme_artwork.sql'),
    join(upgradeDatabase.migrationsDirectory, '0004_theme_artwork.sql'),
  );
  applyMigrations(upgradeDatabase);
  assertFinalSchema(upgradeDatabase);
  assertArtworkInvariants(upgradeDatabase);
  console.log('Validando rollback transacional de migration com erro...');
  await assertRollback(upgradeDatabase);

  console.log('Migrations D1 aprovadas: parser Wrangler, banco vazio, upgrade 0003→0004, invariantes, rollback e schema final.');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
