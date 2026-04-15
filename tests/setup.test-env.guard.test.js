// v1.1 F-009 — regression test for the .env.test guard itself.
//
// The guard's purpose is to refuse to run when POSTGRES_URL points at
// something that does not self-identify as test/sandbox/dev. We can't
// easily test that behavior from inside vitest (because by then the
// setup file has already run), so we spawn a child `node` process with
// a poisoned POSTGRES_URL and assert the child exits non-zero with the
// expected F-009 message.
//
// This test does NOT touch the DB. It re-executes the guard via
// scripts/env-test-doctor.mjs (which shares the logic).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const doctorPath = resolve(process.cwd(), 'scripts/env-test-doctor.mjs');
// On Windows, dynamic import() cannot accept bare paths like d:\foo — it
// requires a file:// URL. The spawnSync child runs outside our module so we
// pre-convert here and use the fileUrl for the child's import() call.
const doctorUrl = pathToFileURL(doctorPath).href;

function runDoctor(envOverrides) {
  return spawnSync('node', [doctorPath], {
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('F-009 env-test-doctor guard', () => {
  it('refuses when NODE_ENV=production', () => {
    const r = runDoctor({ NODE_ENV: 'production' });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/NODE_ENV=production/);
  });

  it('refuses when POSTGRES_URL is empty', () => {
    // dotenv will re-load from .env.test; to simulate "empty", point at an
    // empty-file path via a fake dotenv path is tricky — instead we test by
    // unsetting POSTGRES_URL AFTER dotenv load using a small wrapper.
    const r = spawnSync(
      'node',
      [
        '-e',
        `process.env.POSTGRES_URL=''; process.env.POSTGRES_URL_NON_POOLING=''; await import(${JSON.stringify(doctorUrl)});`,
      ],
      { env: { ...process.env }, encoding: 'utf8', timeout: 10_000 }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/POSTGRES_URL/i);
  });

  it('refuses when POSTGRES_URL points at a production-looking host', () => {
    const r = spawnSync(
      'node',
      [
        '-e',
        `process.env.POSTGRES_URL='postgresql://owner:pw@prod-db.example.com/neondb?sslmode=require'; process.env.POSTGRES_URL_NON_POOLING='postgresql://owner:pw@prod-db.example.com/neondb?sslmode=require'; await import(${JSON.stringify(doctorUrl)}).catch(e => { console.error(e.message); process.exit(1); });`,
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000 }
    );
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/does not self-identify|test-like marker|self-identify as non-production/i);
  });

  it('refuses when POSTGRES_URL has a prod host but db name is also prod-like', () => {
    const r = spawnSync(
      'node',
      [
        '-e',
        `process.env.POSTGRES_URL='postgresql://owner:pw@prod-db.example.com/customers?sslmode=require'; process.env.POSTGRES_URL_NON_POOLING='postgresql://owner:pw@prod-db.example.com/customers?sslmode=require'; await import(${JSON.stringify(doctorUrl)}).catch(e => { console.error(e.message); process.exit(1); });`,
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000 }
    );
    expect(r.status).toBe(1);
  });

  it('accepts a URL with "test" in the host', () => {
    // We can't actually connect to prove success (would need a real DB), but
    // we can assert the refusal layer does NOT trip. The probe step will fail
    // because the host is bogus — that produces exit code 2 (probe failure),
    // not 1 (refusal). Asserting exit != 1 is the meaningful signal here.
    const r = spawnSync(
      'node',
      [
        '-e',
        `process.env.POSTGRES_URL='postgresql://owner:pw@test-sandbox.example.com/neondb?sslmode=require'; process.env.POSTGRES_URL_NON_POOLING='postgresql://owner:pw@test-sandbox.example.com/neondb?sslmode=require'; await import(${JSON.stringify(doctorUrl)}).catch(e => { console.error(e.message); process.exit(2); });`,
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000 }
    );
    // exit 1 = refusal layer tripped (bad)
    // exit 2 = probe failed on bogus host (good — means guard accepted the URL)
    expect(r.status).not.toBe(1);
  });

  it('accepts a URL with "sandbox" in the db name', () => {
    const r = spawnSync(
      'node',
      [
        '-e',
        `process.env.POSTGRES_URL='postgresql://owner:pw@ep-winter-wave.example.com/neondb-sandbox?sslmode=require'; process.env.POSTGRES_URL_NON_POOLING='postgresql://owner:pw@ep-winter-wave.example.com/neondb-sandbox?sslmode=require'; await import(${JSON.stringify(doctorUrl)}).catch(e => { console.error(e.message); process.exit(2); });`,
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000 }
    );
    expect(r.status).not.toBe(1);
  });
});
