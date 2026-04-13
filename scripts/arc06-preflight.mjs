#!/usr/bin/env node
/**
 * ARC-06: pre-flight row-count gate for the REAL → NUMERIC(19,2) migration.
 *
 * The migration inside initDatabase() does
 *   ALTER TABLE ... ALTER COLUMN ... TYPE NUMERIC(19,2) USING ...::numeric
 * on ~25 money columns across 10 business tables. This is idempotent, but it
 * is also the single step that would expose any pre-existing data to a
 * type change — and while NUMERIC strictly widens REAL so no data is lost,
 * running the migration against a branch with real business data means we
 * need to be sure we actually intend to touch it.
 *
 * This script is the gate. It loads env from one of:
 *   - --env=<path>                       (explicit, user-provided)
 *   - .env.local                         (standard Next.js local dev)
 *   - .env.test                          (integration test branch)
 * in that order of precedence, counts rows across every table the migration
 * touches, and refuses to print the migration DDL if ANY table has more
 * than PREFLIGHT_ROW_THRESHOLD rows. Default threshold: 50.
 *
 * Usage:
 *   node scripts/arc06-preflight.mjs                 # default env resolution
 *   node scripts/arc06-preflight.mjs --env=.env.test # force a specific env
 *
 * Exit codes:
 *   0 — all tables under threshold, DDL printed, safe to proceed
 *   1 — env file missing or POSTGRES_URL unset
 *   2 — at least one table over threshold (abort, user must intervene)
 *   3 — DB connection or query error
 *
 * This script is throwaway — not meant to be committed and re-run forever.
 * Keep it in scripts/ for this sprint only.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PREFLIGHT_ROW_THRESHOLD = 50;

// Tables touched by the ARC-06 migration, in the same order they appear
// in initDatabase(). Each has at least one REAL money column.
const TABLES = [
  'purchases',
  'sales',
  'expenses',
  'payments',
  'products',
  'deliveries',
  'bonuses',
  'settlements',
  'price_history',
  'invoices',
];

function parseEnvArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--env=')) return arg.slice('--env='.length);
  }
  return null;
}

function loadEnv() {
  const explicit = parseEnvArg();
  if (explicit) {
    const p = resolve(repoRoot, explicit);
    if (!existsSync(p)) {
      console.error(`FATAL: --env pointed at ${p}, which does not exist.`);
      process.exit(1);
    }
    config({ path: p });
    return p;
  }

  // Default precedence: .env.local > .env.test
  const local = resolve(repoRoot, '.env.local');
  const test = resolve(repoRoot, '.env.test');
  if (existsSync(local)) {
    config({ path: local });
    return local;
  }
  if (existsSync(test)) {
    config({ path: test });
    return test;
  }
  console.error('FATAL: neither .env.local nor .env.test found at repo root.');
  console.error('       Use --env=<path> to specify an env file explicitly.');
  process.exit(1);
}

async function main() {
  const loadedFrom = loadEnv();
  console.log(`[arc06-preflight] loaded env from: ${loadedFrom}`);

  if (!process.env.POSTGRES_URL) {
    console.error('FATAL: POSTGRES_URL is not set after loading env file.');
    console.error('       The sandbox or runtime may be filtering the variable.');
    console.error('       Try running this script outside the Claude Code sandbox.');
    process.exit(1);
  }

  const { sql } = await import('@vercel/postgres');

  console.log('[arc06-preflight] connecting...');
  try {
    // Quick liveness + version check
    const { rows: live } = await sql`SELECT current_database() AS db, version() AS v`;
    console.log(`[arc06-preflight] connected to database: ${live[0].db}`);
  } catch (err) {
    console.error(`FATAL: could not connect: ${err.message}`);
    process.exit(3);
  }

  const counts = {};
  let anyOverThreshold = false;
  let missingTables = 0;

  for (const table of TABLES) {
    try {
      const { rows } = await sql.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
      const n = rows[0].c;
      counts[table] = n;
      const marker = n > PREFLIGHT_ROW_THRESHOLD ? ' ⚠ OVER THRESHOLD' : '';
      console.log(`  ${table.padEnd(18)} ${String(n).padStart(6)} rows${marker}`);
      if (n > PREFLIGHT_ROW_THRESHOLD) anyOverThreshold = true;
    } catch (err) {
      // Table doesn't exist yet (e.g. fresh branch never hit /api/init) —
      // not an abort, just noted. The migration will create it on first run.
      counts[table] = null;
      missingTables++;
      console.log(`  ${table.padEnd(18)}     —  (table does not exist)`);
    }
  }

  console.log('');
  console.log(`[arc06-preflight] summary: ${TABLES.length - missingTables} tables checked, ${missingTables} missing.`);

  if (anyOverThreshold) {
    console.error('');
    console.error('ABORT: at least one table has more than', PREFLIGHT_ROW_THRESHOLD, 'rows.');
    console.error('       The user stated the DB should be empty. Either the wrong env');
    console.error('       file is loaded, or the DB is not actually empty, or the threshold');
    console.error('       is too low for this environment. STOP and investigate before');
    console.error('       running the migration.');
    process.exit(2);
  }

  console.log('');
  console.log('[arc06-preflight] ✓ all tables under threshold. Safe to proceed.');
  console.log('');
  console.log('Next step: run the migration by hitting /api/init (GET or POST with empty body)');
  console.log('           against the same DB this preflight just checked. The ALTER');
  console.log('           statements are idempotent — running them twice is safe.');
  console.log('');
  console.log('Alternatively, run the initDatabase() entry programmatically:');
  console.log('   node -e "import(\'./lib/db.js\').then(m => m.initDatabase())"');
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(`FATAL: unhandled error: ${err.message}`);
  console.error(err.stack);
  process.exit(3);
});
