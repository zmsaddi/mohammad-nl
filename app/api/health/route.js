import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// v1.1 S5.6 [F-064] — health/readiness endpoint.
//
// Returns { ok, db_latency_ms, timestamp }. No auth required — this
// is for uptime monitors, load balancers, and the ops team to check
// if the app + DB are responsive without logging in.
//
// GET /api/health → 200 { ok: true, db_latency_ms: N, timestamp: ISO }
//                 → 503 { ok: false, error: "...", timestamp: ISO }

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
      version: 'v1.1.0',
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'DB unreachable',
        timestamp,
        version: 'v1.1.0',
      },
      { status: 503 }
    );
  }
}
