#!/usr/bin/env node
/**
 * FEAT-01: One-time backfill — generate aliases for all existing entities.
 *
 * Idempotent. Safe to re-run. Uses addGeneratedAlias() which has
 * first-writer-wins semantics, so re-runs preserve existing aliases
 * (no entity-id stealing, no frequency bumps).
 *
 * Usage:
 *   node scripts/backfill-aliases.mjs
 *
 * Pre-flight: reads POSTGRES_URL from .env.test or .env.local. Run against
 * the database you actually want to populate.
 *
 * Output: per-table counts of processed/skipped/aliases_created plus a
 * final summary. SKIPs are logged with the entity id and skip reason for
 * post-run inspection.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Load .env.test first (the integration-test config), then fall back to
// .env.local for developer machines.
config({ path: resolve(repoRoot, '.env.test') });
config({ path: resolve(repoRoot, '.env.local') });

if (!process.env.POSTGRES_URL) {
  console.error('FATAL: POSTGRES_URL not set. Configure .env.test or .env.local.');
  process.exit(1);
}

const { sql } = await import('@vercel/postgres');
const {
  generateProductAliases,
  generateSupplierAliases,
  generateClientAliases,
} = await import('../lib/alias-generator.js');
const { addGeneratedAlias } = await import('../lib/db.js');
const { normalizeForMatching } = await import('../lib/voice-normalizer.js');
const { invalidateCache } = await import('../lib/entity-resolver.js');

async function backfillEntityType(entityType, generator, table) {
  console.log(`\nBackfilling ${entityType}...`);
  const { rows } = await sql.query(`SELECT id, name FROM ${table}`);
  let processed = 0;
  let skipped = 0;
  let aliasesCreated = 0;

  for (const row of rows) {
    const result = generator(row.name);
    if (result.skip) {
      skipped++;
      console.log(`  SKIP ${entityType}#${row.id} "${row.name}": ${result.reason}`);
      continue;
    }
    for (const alias of result.aliases) {
      const normalized = normalizeForMatching(alias);
      await addGeneratedAlias(entityType, row.id, alias, normalized);
      aliasesCreated++;
    }
    processed++;
  }

  console.log(
    `  ${entityType}: processed=${processed} skipped=${skipped} aliases_created=${aliasesCreated}`
  );
  return { processed, skipped, aliasesCreated };
}

async function main() {
  console.log('FEAT-01: alias backfill starting...');
  const startedAt = Date.now();

  const totals = { processed: 0, skipped: 0, aliasesCreated: 0 };
  const add = (r) => {
    totals.processed += r.processed;
    totals.skipped += r.skipped;
    totals.aliasesCreated += r.aliasesCreated;
  };

  add(await backfillEntityType('product', generateProductAliases, 'products'));
  add(await backfillEntityType('supplier', generateSupplierAliases, 'suppliers'));
  add(await backfillEntityType('client', generateClientAliases, 'clients'));

  // Cache invalidation — same call as generateAndPersistAliases() so the next
  // voice request rebuilds the resolver Fuse index from the freshly-populated
  // alias table.
  invalidateCache();

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `\nBackfill complete in ${elapsedMs}ms.\n` +
    `Total: processed=${totals.processed} skipped=${totals.skipped} aliases_created=${totals.aliasesCreated}`
  );
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
