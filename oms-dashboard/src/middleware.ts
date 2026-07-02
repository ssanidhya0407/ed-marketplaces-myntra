import { NextRequest, NextResponse } from 'next/server';

// Page-level gate. The data API (/orders/api/*) is guarded by the backend; this
// only stops unauthenticated browsers from loading the UI. It verifies the same
// HMAC-signed `oms_session` cookie the backend issues, so a missing/forged/expired
// cookie redirects to /login.
//
// OMS_SESSION_SECRET is inlined at build time (next.config.ts `env`) because the
// Edge runtime does not read arbitrary runtime env. Rebuild the frontend to rotate.
const COOKIE = 'oms_session';
const SECRET = process.env.OMS_SESSION_SECRET || '';

// Returns a Uint8Array view (not a bare ArrayBuffer): the Edge SubtleCrypto wants
// an ArrayBufferView for the signature/data arguments. Backed by an explicit
// ArrayBuffer so the type is `Uint8Array<ArrayBuffer>` (a valid BufferSource).
function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function validSession(token: string | undefined): Promise<boolean> {
  if (!token || !SECRET) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(body));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname.startsWith('/login/')) return NextResponse.next();

  if (await validSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname && pathname !== '/') url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

// Run on everything except Next internals, static assets, and the backend data API
// (/orders/api/* is guarded by the backend itself and, in prod, is routed straight to
// it by nginx — never reaching this middleware; excluding it here keeps the local
// dev proxy working the same way, so the login/auth calls reach the backend).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|orders/api|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
