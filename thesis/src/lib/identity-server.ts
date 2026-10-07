import { cookies } from 'next/headers';

import { IDENTITY_COOKIE, verifyOwnerCookie } from './identity';

/**
 * The visitor a server component is rendering for.
 *
 * Kept apart from identity.ts because next/headers only exists inside a
 * request, and identity.ts also runs in the proxy and in plain scripts.
 * Null only when the proxy did not run for this request.
 */
export async function currentOwner(): Promise<string | null> {
  return verifyOwnerCookie((await cookies()).get(IDENTITY_COOKIE)?.value);
}
