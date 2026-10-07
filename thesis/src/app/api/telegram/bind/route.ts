import { cookies } from 'next/headers';

import { IDENTITY_COOKIE, IDENTITY_COOKIE_OPTIONS, ownerFromRequest, signOwnerId } from '@/lib/identity';
import { transferTheses } from '@/thesis/ownership';
import { getStore } from '@/thesis/store';
import { getBindingStore } from '@/telegram/bindings';
import { botToken, getMe } from '@/telegram/client';

/**
 * The browser's half of the handshake.
 *
 * POST   mint a code for this browser, and hand back the deep link
 * GET    has the code been redeemed yet
 * DELETE disconnect this browser's chat
 *
 * WHY A DEEP LINK AND A TYPED CODE, RATHER THAN EITHER ONE
 *
 * t.me/<bot>?start=<code> is one tap and no typing, which is the whole
 * interaction on a phone. But it opens Telegram, and a judge watching a demo
 * on a laptop with no desktop Telegram installed gets a dead link. The code is
 * the fallback that always works, and it costs one line of copy to offer both.
 *
 * WHAT THIS ENDPOINT DELIBERATELY DOES NOT DO
 *
 * It never returns a chat id, and it never accepts one. A browser that could
 * name a chat could subscribe it, and the code exists precisely so that the
 * person holding the Telegram account is the one who consents. The desk learns
 * only that SOMEONE redeemed its code, and what to call them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The bot's @username, cached for the life of the instance.
 *
 * It cannot change for a given token, so asking Telegram on every bind would
 * add a network round trip to a button press for a value that is constant.
 */
let username: string | null = null;

async function botUsername(): Promise<string | null> {
  if (username) return username;
  const me = await getMe();
  if (!me.ok) return null;
  username = me.value.username ?? null;
  return username;
}

/*
  WHO IS BINDING

  This used to be a random id the browser kept in localStorage and sent with
  every call. It is now the signed identity cookie, read on the server, so the
  browser no longer names itself: a caller cannot ask about, bind or unbind a
  session that is not its own.
*/
function noIdentity(): Response {
  return Response.json({ error: 'No identity on this request. Reload the page.' }, { status: 401 });
}

function disabled(): Response {
  return Response.json(
    {
      configured: false,
      error: 'Telegram is not configured on this deployment. TG_BOT_TOKEN is not set.',
    },
    { status: 503 },
  );
}

// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  if (!botToken()) return disabled();

  const sessionId = await ownerFromRequest(request);
  if (!sessionId) return noIdentity();

  try {
    const pending = await getBindingStore().createCode(sessionId);
    const handle = await botUsername();

    return Response.json(
      {
        configured: true,
        code: pending.code,
        expiresAt: pending.expiresAt,
        bot: handle ? `@${handle}` : null,
        // Null rather than a guessed URL. A dead deep link in a demo is worse
        // than a code the user types.
        deepLink: handle ? `https://t.me/${handle}?start=${pending.code}` : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!botToken()) return disabled();

  let sessionId = await ownerFromRequest(request);
  if (!sessionId) return noIdentity();

  try {
    const store = getBindingStore();

    /*
      SIGN-IN, the browser's half. The bot left a grant here when this
      browser's code arrived from a chat that already belongs to someone. This
      browser becomes that someone: its cookie is re-issued, and anything it
      wrote while anonymous moves across rather than being stranded under an
      id nobody will present again.
    */
    let signedIn = false;
    const adopted = await store.takeSignIn(sessionId);
    if (adopted && adopted !== sessionId) {
      await transferTheses(getStore(), sessionId, adopted);
      (await cookies()).set(IDENTITY_COOKIE, await signOwnerId(adopted), IDENTITY_COOKIE_OPTIONS);
      sessionId = adopted;
      signedIn = true;
    }

    const binding = await store.bySession(sessionId);
    return Response.json(
      binding
        ? {
            configured: true,
            bound: true,
            chatName: binding.chatName,
            muted: binding.muted,
            notified: binding.notified,
            boundAt: binding.boundAt,
            signedIn,
          }
        : { configured: true, bound: false, signedIn },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

// ---------------------------------------------------------------------------

export async function DELETE(request: Request): Promise<Response> {
  if (!botToken()) return disabled();

  const sessionId = await ownerFromRequest(request);
  if (!sessionId) return noIdentity();

  try {
    const store = getBindingStore();
    const binding = await store.bySession(sessionId);
    // Removal is by chat id, because that is what the binding is keyed by.
    if (binding) await store.remove(binding.chatId);
    return Response.json({ configured: true, bound: false });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
