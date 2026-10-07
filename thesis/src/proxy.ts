import { NextResponse, type NextRequest } from 'next/server';

import {
  IDENTITY_COOKIE,
  IDENTITY_COOKIE_OPTIONS,
  newOwnerId,
  signOwnerId,
  verifyOwnerCookie,
} from '@/lib/identity';

/**
 * Gives every visitor an identity on their first request.
 *
 * The new cookie is set on the response AND written into this request's
 * Cookie header, so the page being rendered right now already knows who it
 * is rendering for. Without the second half, a first visit would render as
 * nobody and the visitor's first thesis would be saved without an owner.
 *
 * A valid cookie passes straight through. An invalid one (edited, forged,
 * signed with a rotated secret) is replaced, never trusted.
 */
export async function proxy(request: NextRequest) {
  const current = request.cookies.get(IDENTITY_COOKIE)?.value;
  if (await verifyOwnerCookie(current)) return NextResponse.next();

  const value = await signOwnerId(newOwnerId());
  request.cookies.set(IDENTITY_COOKIE, value);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(IDENTITY_COOKIE, value, IDENTITY_COOKIE_OPTIONS);
  return response;
}

export const config = {
  matcher: [
    /*
      Everything a person loads, and nothing a machine does. Static assets do
      not need an owner, and the cron and the Telegram webhook are not
      visitors: minting them an identity on every call would be noise.
    */
    '/((?!_next/static|_next/image|api/recheck|api/telegram/webhook|.*\\.(?:png|webp|jpg|jpeg|svg|ico|txt|xml)$).*)',
  ],
};
