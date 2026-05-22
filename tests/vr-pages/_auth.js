import { encode } from 'next-auth/jwt';
import { VR_SECRET } from './_secret.js';

// Mints a next-auth (v4, JWT strategy) session cookie for an admin user, so
// Playwright can reach the auth-gated pages without a real login or DB. The
// proxy.js middleware decodes it via getToken() with the same secret, and the
// /api/auth/session route returns a session with role=admin. NEXTAUTH_URL is
// http (localhost), so the non-secure cookie name applies.
export async function adminSessionCookie() {
  const value = await encode({
    token: { name: 'مدير عام', role: 'admin', username: 'admin', id: '1', sub: '1' },
    secret: VR_SECRET,
    maxAge: 60 * 60 * 24,
  });
  return {
    name: 'next-auth.session-token',
    value,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  };
}
