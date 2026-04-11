import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

// Role-based page access
const PAGE_ROLES = {
  '/summary': ['admin', 'manager'],
  '/purchases': ['admin', 'manager'],
  '/expenses': ['admin', 'manager'],
  '/stock': ['admin', 'manager'],
  '/clients': ['admin', 'manager'],
  '/sales': ['admin', 'manager', 'seller'],
  '/deliveries': ['admin', 'manager', 'seller', 'driver'],
  '/users': ['admin'],
  '/settlements': ['admin'],
};

// Default page per role (redirect when accessing unauthorized page)
const DEFAULT_PAGE = {
  admin: '/summary',
  manager: '/summary',
  seller: '/sales',
  driver: '/deliveries',
};

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  // Not logged in → redirect to login
  if (!token) {
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
