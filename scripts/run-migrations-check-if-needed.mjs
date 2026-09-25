#!/usr/bin/env node
// A suíte completa de scripts/validate-d1-migrations.mjs recria e faz upgrade
// de bancos D1 sintéticos por várias migrations históricas, uma a uma; é a
// checagem certa para qualquer mudança de schema, mas é pesada (minutos) e
// não descobre nada novo quando nenhum arquivo sensível a migration mudou no
// commit publicado. Rodá-la em todo deploy de produção arriscava estourar o
// timeout de build da Cloudflare mesmo em correções sem relação com schema.
// Este wrapper roda a suíte completa sempre que não for possível provar, com
// segurança, que nada sensível mudou — nunca pula por engano.
import { execFileSync } from 'node:child_process';

const MIGRATION_SENSITIVE_PATTERNS = [
  /^apps\/worker\/migrations\//,
  /^scripts\/validate-d1-migrations\.mjs$/,
  /^apps\/worker\/wrangler\.jsonc$/,
];

/** @returns {string | null} */
function resolvedRef(ref) {
  try {
    const output = execFileSync('git', ['rev-parse', '--verify', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return String(output).trim();
  } catch {
    return null;
  }
}

/** @returns {string[] | null} */
function changedFilesSincePreviousCommit() {
  if (resolvedRef('HEAD~1') === null) return null;
  try {
    const output = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { encoding: 'utf8' });
    return String(output)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

function runFullMigrationSuite(reason) {
  console.log(`Rodando validação completa de migrations D1 (${reason})...`);
  execFileSync('npm', ['run', 'test:migrations'], { stdio: 'inherit' });
}

const changedFiles = changedFilesSincePreviousCommit();

if (changedFiles === null) {
  runFullMigrationSuite('não foi possível determinar com segurança o diff do commit anterior');
} else if (changedFiles.length === 0) {
  runFullMigrationSuite('diff vazio contra o commit anterior');
} else {
  const sensitiveMatch = changedFiles.find((file) => MIGRATION_SENSITIVE_PATTERNS.some((pattern) => pattern.test(String(file))));
  if (sensitiveMatch !== undefined) {
    runFullMigrationSuite(`arquivo sensível a migration alterado: ${sensitiveMatch}`);
  } else {
    console.log('test:migrations pulado no build de deploy: nenhuma migration, validador ou binding D1 mudou neste commit.');
    console.log('A suíte completa continua obrigatória localmente via `npm run check` antes de qualquer push.');
  }
}
