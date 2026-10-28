import { NextResponse, type NextRequest } from 'next/server';
import { REFRESH_COOKIE_NAME } from '@club/shared';
export function middleware(request: NextRequest) {
  if (!request.cookies.has(REFRESH_COOKIE_NAME)) {
    const target = new URL('/login', request.url);
    target.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}
export const config = {
  matcher: [
    '/cabinet/:path*',
    '/trips/:path*',
    '/events/:path*',
    '/curator/:path*',
    '/admin/:path*',
    '/onboarding',
  ],
};
