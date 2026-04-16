// v1.1 S4.7 [F-068] — unified auth helper for API routes.
//
// Pre-v1.1 every route handler copy-pasted:
//   async function checkAuth(request) {
//     return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
//   }
// and then inlined its own role check. 5+ copies, each a place
// where a dev can forget a role check.
//
// This module provides a single `requireAuth(request, roles?)`
// that returns `{ token }` or a NextResponse error. Routes call
// it at the top and short-circuit on error:
//
//   const auth = await requireAuth(request, ['admin', 'manager']);
//   if (auth.error) return auth.error;
//   const { token } = auth;
//
// The error is a fully-formed NextResponse (401 or 403) with an
// Arabic message, so the route doesn't need to construct one.

import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

/**
 * Authenticate the request and optionally enforce role allowlist.
 *
 * @param {Request} request  Next.js request object
 * @param {string[]} [roles]  If provided, token.role must be in this array.
 *   If omitted, any authenticated user is accepted.
 * @returns {Promise<{token: object} | {error: NextResponse}>}
 */
export async function requireAuth(request, roles) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) };
  }
  if (roles && !roles.includes(token.role)) {
    return { error: NextResponse.json({ error: 'غير مصرح — صلاحيات غير كافية' }, { status: 403 }) };
  }
  return { token };
}
