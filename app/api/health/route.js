import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import pkg from '../../../package.json' with { type: 'json' };

// v1.1 S5.6 [F-064] — health/readiness endpoint.
//
// Returns { ok, db_latency_ms, timestamp, version }. No auth required —
// this is for uptime monitors, load balancers, and the ops team to check
// if the app + DB are responsive without logging in. Version is read from
// package.json so a single source of truth drives the metadata.
//
// GET /api/health → 200 { ok: true, db_latency_ms: N, timestamp: ISO }
//                 → 503 { ok: false, error: "...", timestamp: ISO }

const VERSION = `v${pkg.version}`;

export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    const t0 = Date.now();
    await sql`SELECT 1`;
    const db_latency_ms = Date.now() - t0;
    return NextResponse.json({
      ok: true,
      db_latency_ms,
      timestamp,
      version: VERSION,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'DB unreachable',
        timestamp,
        version: VERSION,
      },
      { status: 503 }
    );
  }
}
