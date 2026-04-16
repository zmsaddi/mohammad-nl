#!/usr/bin/env node
// One-shot cleanup script: truncate all transactional data, keep users + settings + user_bonus_rates.
// Usage: node scripts/clean-db.mjs

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { sql } from '@vercel/postgres';

const TABLES_TO_TRUNCATE = [
  // Order matters: children first (FK dependencies)
  'cancellations',
  'invoices',
  'bonuses',
  'supplier_payments',
  'price_history',
  'profit_distributions',
  'voice_logs',
  'ai_corrections',
  'ai_patterns',
  'entity_aliases',
  'deliveries',
  'settlements',
  'payments',
  'sales',
  'expenses',
  'purchases',
  'products',
  'suppliers',
  'clients',
  'invoice_sequence',
];

async function main() {
  console.log('=== Database Cleanup for Final Delivery ===\n');

  // Show what we're keeping
  const usersResult = await sql`SELECT username, name, role FROM users ORDER BY role, username`;
  console.log(`Keeping ${usersResult.rows.length} users:`);
  usersResult.rows.forEach(u => console.log(`  - ${u.username} (${u.name}) [${u.role}]`));

  const settingsResult = await sql`SELECT key, value FROM settings LIMIT 20`;
  console.log(`\nKeeping ${settingsResult.rows.length} settings entries`);

  const ratesResult = await sql`SELECT username FROM user_bonus_rates`;
  console.log(`Keeping ${ratesResult.rows.length} per-user bonus rate overrides\n`);

  // Truncate all transactional tables
  console.log('Truncating transactional tables...');
  for (const table of TABLES_TO_TRUNCATE) {
    try {
      await sql.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      console.log(`  [OK] ${table}`);
    } catch (err) {
      if (/does not exist/i.test(err.message)) {
        console.log(`  [SKIP] ${table} (not found)`);
      } else {
        console.log(`  [ERR] ${table}: ${err.message}`);
      }
    }
  }

  // Verify cleanup
  console.log('\n=== Verification ===');
  const checks = ['sales', 'purchases', 'expenses', 'deliveries', 'invoices', 'clients', 'products', 'bonuses', 'settlements', 'profit_distributions', 'users', 'settings'];
  for (const t of checks) {
    try {
      const r = await sql.query(`SELECT COUNT(*) as c FROM ${t}`);
      const count = r.rows[0].c;
      const kept = (t === 'users' || t === 'settings') ? ' (KEPT)' : '';
      console.log(`  ${t}: ${count} rows${kept}`);
    } catch { /* table might not exist */ }
  }

  console.log('\nDone. Database is clean for delivery.');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
