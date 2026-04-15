#!/usr/bin/env node
/**
 * v1.1 F-009 — .env.test doctor
 *
 * Stand-alone safety probe. Reports what your `.env.test` points at
 * WITHOUT issuing any DDL. Run this BEFORE `npm test` any time you've
 * touched env files or rotated credentials.
 *
 * Usage:
 *   node scripts/env-test-doctor.mjs
 *
 * Exit codes:
 *   0 — safe to run tests
 *   1 — refused; env points at what looks like production
 *   2 — probe failure (connection, missing vars)
 *
 * Also invoked automatically by the `pretest` npm script.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { sql } from '@vercel/postgres';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

config({ path: resolve(process.cwd(), '.env.test') });

function die(code, msg) {
  console.error(`${RED}✖ env-test-doctor REFUSING: ${msg}${RESET}`);
  console.error(`${RED}  Fix .env.test and re-run. See docs/v1-1-comprehensive-study.md §F-009.${RESET}`);
  process.exit(code);
}

function ok(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

console.log(`${CYAN}== .env.test doctor (F-009 guard) ==${RESET}`);

// 1. NODE_ENV must not be production
if (process.env.NODE_ENV === 'production') {
  die(1, 'NODE_ENV=production. Tests must never run with NODE_ENV=production.');
}
ok(`NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);

// 2. POSTGRES_URL must be set
const url = process.env.POSTGRES_URL;
if (!url) {
  die(2, '.env.test missing or POSTGRES_URL not set.');
}
if (!url.startsWith('postgresql://')) {
  die(2, 'POSTGRES_URL does not look like a valid Postgres URL.');
}

// 3. URL must contain test/sandbox/dev marker in host OR database name
//    The test env is considered safe iff the connection string literally
//    names itself as test-like. "Prove you're test" beats "hope you're not prod".
let host, dbName;
try {
  // Node's URL class handles postgresql:// natively.
  const parsed = new URL(url.trim());
  host = parsed.hostname.toLowerCase();
  dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
} catch (err) {
  die(2, `Unparseable POSTGRES_URL: ${err.message}`);
}
const safePattern = /(test|sandbox|dev|staging|preview|ephemeral)/i;

const hostSafe = safePattern.test(host);
const dbSafe = safePattern.test(dbName);

if (!hostSafe && !dbSafe) {
  console.error(`${RED}✖ Neither host nor database name contains a test-like marker.${RESET}`);
  console.error(`  host:     ${host}`);
  console.error(`  database: ${dbName}`);
  console.error(`${RED}  Expected host or database to match /test|sandbox|dev|staging|preview|ephemeral/i${RESET}`);
  die(1, 'POSTGRES_URL does not self-identify as non-production.');
}

// 4. Trailing whitespace / newline in the URL (bug noted in study §5.8)
if (url !== url.trim() || /[\n\r]/.test(url)) {
  warn('POSTGRES_URL has trailing whitespace or embedded newline. Trim it.');
}

// 5. Probe current_database() — the definitive answer
let probe;
try {
  probe = await sql`SELECT current_database() AS name, current_user AS "user", version() AS v`;
} catch (err) {
  die(2, `Probe failed: ${err.message}`);
}
const probeName = probe.rows[0].name;
const probeUser = probe.rows[0].user;
ok(`Connected to database "${probeName}" as "${probeUser}"`);
ok(`Host parsed from URL: ${host}`);

// 6. Probe tables — if we see a populated business table, scream
try {
  const usersCheck = await sql`SELECT COUNT(*)::int AS n FROM users WHERE username NOT IN ('admin', 'test', 'seed')`;
  const realUsers = usersCheck.rows[0].n;
  if (realUsers > 10) {
    die(1, `Target DB has ${realUsers} non-seed users — looks like production data.`);
  }
  ok(`Target DB has ${realUsers} non-seed user rows (threshold: 10)`);
} catch (err) {
  // users table may not exist on a brand-new branch — that's fine
  if (/relation "users" does not exist/i.test(err.message)) {
    ok('users table not yet initialized (brand-new branch)');
  } else {
    warn(`users table probe failed: ${err.message}`);
  }
}

// 7. Final green light
console.log('');
console.log(`${GREEN}✓ env-test-doctor OK — safe to run tests${RESET}`);
console.log('');
process.exit(0);
