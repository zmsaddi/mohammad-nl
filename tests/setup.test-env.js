// v1.1 F-009 — .env.test hard guard (setup phase, no network).
//
// Runs for EVERY test (mock-only and real-DB alike). Two responsibilities:
//   1. Load .env.test into process.env so route tests see the config.
//   2. Refuse to proceed if POSTGRES_URL points at something that does not
//      self-identify as test/sandbox/dev/staging/preview/ephemeral.
//
// The DB probe (SELECT current_database(), count non-seed users) lives in
// scripts/env-test-doctor.mjs and runs at `pretest`. This keeps mock-only
// test files from needing a working DB.
//
// Pre-v1.1 this file only verified "URL is set" and "starts with
// postgresql://". That was insufficient: a .env.test copied over .env.local,
// or a developer shell with production credentials in the environment, would
// run the suite against production and TRUNCATE customer data.
//
// Rationale for "prove you're test" instead of "hope you're not prod":
// there is no safe way to enumerate every possible production hostname, but
// there IS a safe way to require every test environment to self-identify.
//
// Regression test: tests/setup.test-env.guard.test.js — spawns child nodes
// with poisoned env and asserts the doctor exits non-zero with F-009 text.
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.test') });

const REFUSAL_PREFIX = 'F-009 env-test guard REFUSING TO RUN:';
const SAFE_PATTERN = /(test|sandbox|dev|staging|preview|ephemeral)/i;

if (process.env.NODE_ENV === 'production') {
  throw new Error(`${REFUSAL_PREFIX} NODE_ENV=production is never valid for tests.`);
}

const rawUrl = process.env.POSTGRES_URL;
if (!rawUrl) {
  throw new Error(`${REFUSAL_PREFIX} .env.test missing or POSTGRES_URL not set.`);
}
if (!rawUrl.startsWith('postgresql://')) {
  throw new Error(`${REFUSAL_PREFIX} POSTGRES_URL does not look like a valid Postgres URL.`);
}

// Strip whitespace/newlines — the v1.0.x .env.test had a literal "\n"
// trailing the quoted URL which works today by accident but could break on
// dotenv upgrade.
const url = rawUrl.trim().replace(/[\r\n]/g, '');
if (url !== rawUrl) {
  process.env.POSTGRES_URL = url;
}

let host = '';
let dbName = '';
try {
  const parsed = new URL(url);
  host = parsed.hostname.toLowerCase();
  dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
} catch (err) {
  throw new Error(`${REFUSAL_PREFIX} unparseable POSTGRES_URL: ${err.message}`);
}

if (!SAFE_PATTERN.test(host) && !SAFE_PATTERN.test(dbName)) {
  throw new Error(
    `${REFUSAL_PREFIX} POSTGRES_URL does not self-identify as non-production.\n` +
    `  host:     ${host}\n` +
    `  database: ${dbName}\n` +
    `  Expected host or database to match /test|sandbox|dev|staging|preview|ephemeral/i\n` +
    `  Fix: create a dedicated Neon branch named "test-sandbox" (or similar), update\n` +
    `  .env.test to point at it, and re-run. See docs/v1-1-comprehensive-study.md §F-009.`
  );
}

// Same treatment for NON_POOLING URL if provided.
const nonPooling = process.env.POSTGRES_URL_NON_POOLING;
if (nonPooling) {
  const np = nonPooling.trim().replace(/[\r\n]/g, '');
  if (np !== nonPooling) {
    process.env.POSTGRES_URL_NON_POOLING = np;
  }
  let npHost = '';
  let npDb = '';
  try {
    const p = new URL(np);
    npHost = p.hostname.toLowerCase();
    npDb = p.pathname.replace(/^\//, '').toLowerCase();
  } catch (err) {
    throw new Error(`${REFUSAL_PREFIX} unparseable POSTGRES_URL_NON_POOLING: ${err.message}`);
  }
  if (!SAFE_PATTERN.test(npHost) && !SAFE_PATTERN.test(npDb)) {
    throw new Error(
      `${REFUSAL_PREFIX} POSTGRES_URL_NON_POOLING does not self-identify as non-production.\n` +
      `  host:     ${npHost}\n` +
      `  database: ${npDb}`
    );
  }
}

// Silent success — importing this file is the guard.
