#!/usr/bin/env node
// v1.2 — Versioned migration runner.
//
// Reads SQL files from scripts/migrations/v1-2/ (or any subdirectory
// matching the --dir flag), runs them in filename-sort order, and
// records each in a `schema_migrations` table so it never re-runs.
//
// Usage:
//   node --env-file=.env.test scripts/migrate.mjs
//   node --env-file=.env.test scripts/migrate.mjs --dir scripts/migrations/v1-2
//   node --env-file=.env.test scripts/migrate.mjs --dry-run
//
// The runner:
//   1. Creates `schema_migrations` if it doesn't exist
//   2. Lists all *.sql files in the migration directory, sorted by name
//   3. For each file not yet in `schema_migrations`:
//      a. Reads the SQL content
//      b. Executes it in a single transaction
//      c. Records (version, filename, checksum, ran_at) on success
//      d. Stops on first failure (no partial state)
//   4. Reports what ran and what was already applied
//
// Naming convention: NNN-description.sql where NNN is a 3-digit sequence.
// Example: 001-profit-distribution-groups.sql
//
// The runner does NOT touch initDatabase — that's the bootstrap path
// for brand-new databases. Migrations here are for INCREMENTAL schema
// changes on existing databases.

import { sql, db } from '@vercel/postgres';
import { readdirSync, readFileSync } from 'fs';
import { resolve, basename } from 'path';
import { createHash } from 'crypto';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirFlag = args.find((a, i) => args[i - 1] === '--dir');
const migrationDir = resolve(process.cwd(), dirFlag || 'scripts/migrations/v1-2');

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      ran_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function getAppliedVersions() {
  const { rows } = await sql`SELECT version, checksum FROM schema_migrations ORDER BY version`;
  return new Map(rows.map(r => [r.version, r.checksum]));
}

function getMigrationFiles(dir) {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(f => ({
        filename: f,
        version: f.replace(/\.sql$/, ''),
        path: resolve(dir, f),
      }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`Migration directory not found: ${dir}`);
      return [];
    }
    throw err;
  }
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function run() {
  console.log(`Migration runner — dir: ${migrationDir}${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('');

  await ensureMigrationsTable();
  const applied = await getAppliedVersions();
  const files = getMigrationFiles(migrationDir);

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  let ranCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const content = readFileSync(file.path, 'utf8');
    const hash = checksum(content);

    if (applied.has(file.version)) {
      const existingHash = applied.get(file.version);
      if (existingHash !== hash) {
        console.error(`CHECKSUM MISMATCH: ${file.filename}`);
        console.error(`  applied: ${existingHash}`);
        console.error(`  current: ${hash}`);
        console.error('  Migration file was modified after it was applied. This is dangerous.');
        console.error('  Fix the file or manually update schema_migrations.checksum.');
        process.exit(1);
      }
      skippedCount++;
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] would apply: ${file.filename} (${hash})`);
      ranCount++;
      continue;
    }

    console.log(`  applying: ${file.filename} ...`);
    const client = await db.connect();
    try {
      await client.sql`BEGIN`;
      // Execute the migration SQL. Note: tagged templates don't support
      // multi-statement SQL, so we use client.query() for raw execution.
      await client.query(content);
      // Record the migration
      await client.sql`
        INSERT INTO schema_migrations (version, filename, checksum)
        VALUES (${file.version}, ${file.filename}, ${hash})
      `;
      await client.sql`COMMIT`;
      console.log(`  ✓ ${file.filename} applied`);
      ranCount++;
    } catch (err) {
      try { await client.sql`ROLLBACK`; } catch { /* session dead */ }
      console.error(`  ✖ ${file.filename} FAILED: ${err.message}`);
      console.error('  Stopping. No further migrations will be applied.');
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log('');
  console.log(`Done. ${ranCount} applied, ${skippedCount} already applied, ${files.length} total.`);
}

run().catch(err => {
  console.error('Migration runner crashed:', err.message);
  process.exit(1);
});
