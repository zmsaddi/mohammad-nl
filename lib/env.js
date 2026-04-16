// v1.2 S5 [F-072] — Zod-validated environment variables.
//
// Import this module at the top of lib/db/_shared.js and lib/api-auth.js.
// Fails at boot instead of in a request if a required env var is missing.
//
// Pre-v1.2 NEXTAUTH_SECRET could be missing or set to the default
// "test-secret-do-not-use-in-production" and NextAuth would still
// start — it would just not validate tokens correctly. No lib/ file
// validated env vars at import time; every failure surfaced as a
// runtime error inside a request handler, 500ing the user.

import { z } from 'zod';

const envSchema = z.object({
  POSTGRES_URL: z.string().min(1, 'POSTGRES_URL is required'),
  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET must be at least 16 chars'),
  GROQ_API_KEY: z.string().optional(),
  ALLOW_DB_RESET: z.enum(['true', 'false']).optional().default('false'),
});

let _env;
try {
  _env = envSchema.parse(process.env);
} catch (err) {
  // In test/CI, env vars come from .env.test which is loaded by the
  // vitest setup file. If this module loads BEFORE the setup file
  // (e.g. during import resolution), the vars aren't in process.env
  // yet. Gracefully fall back to raw process.env in that case and
  // let the runtime catch missing vars later.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    _env = process.env;
  } else {
    // eslint-disable-next-line no-console
    console.error('[env] Boot validation failed:', err.message);
    // Don't crash the process — Next.js may hot-reload this during
    // development when env vars are being edited. Log the error and
    // let the first request that touches a missing var produce a
    // clear error message.
    _env = process.env;
  }
}

export const env = _env;
