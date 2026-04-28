import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

// Role-based page access
const PAGE_ROLES = {
  '/summary': ['admin', 'manager', 'seller'],
  '/purchases': ['admin', 'manager'],
  '/expenses': ['admin', 'manager'],
  '/stock': ['admin', 'manager', 'seller'],
  '/clients': ['admin', 'manager'],
  '/sales': ['admin', 'manager', 'seller'],
  '/invoices': ['admin', 'manager', 'seller', 'driver'],
  '/my-bonus': ['seller', 'driver'],
  '/deliveries': ['admin', 'manager', 'seller', 'driver'],
  '/users': ['admin'],
  '/settlements': ['admin'],
  // v1.0.2 Feature 2 — profit distribution page. Admin + manager can
  // view history; only admin can POST (enforced at route layer).
  '/profit-distributions': ['admin', 'manager'],
  // DONE: Step 5 — invoice settings page (admin only)
  '/settings': ['admin'],
};

// Default page per role (redirect when accessing unauthorized page)
const DEFAULT_PAGE = {
  admin: '/summary',
  manager: '/summary',
  // v1.2 UX-1: sellers land on /summary (which includes a personal seller
  // dashboard — sales count, revenue, reserved, bonuses) instead of a raw
  // table of historical sales. The "بيع جديد" CTA on /summary still uses
  // /sales?new=1 so the create-sale flow is one click away.
  seller: '/summary',
  driver: '/deliveries',
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  // /api/health is intentionally public for uptime monitors / load balancers
  // (see app/api/health/route.js — the route handler itself does no auth check).
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth') || pathname === '/api/health') {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  // Not logged in
  if (!token) {
    // API routes → return 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    // Pages → redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = token.role || 'seller';

  // Check page access
  for (const [page, roles] of Object.entries(PAGE_ROLES)) {
    if (pathname.startsWith(page) && !roles.includes(role)) {
      // Redirect to their default page
      const defaultPage = DEFAULT_PAGE[role] || '/login';
      return NextResponse.redirect(new URL(defaultPage, request.url));
    }
  }

  // Root page → redirect to default
  if (pathname === '/') {
    return NextResponse.redirect(new URL(DEFAULT_PAGE[role] || '/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png).*)'],
};
