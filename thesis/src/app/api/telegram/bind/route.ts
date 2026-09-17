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

function sessionFrom(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('session')?.trim();
  return value ? value : null;
}

/** A session id is opaque to us, but it is a key, so it gets a shape. */
function validSession(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
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

  let body: { sessionId?: unknown };
  try {
    body = (await request.json()) as { sessionId?: unknown };
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!validSession(sessionId)) {
    return Response.json({ error: 'sessionId must be 8 to 64 url-safe characters.' }, { status: 400 });
  }

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

  const sessionId = sessionFrom(request);
  if (!sessionId || !validSession(sessionId)) {
    return Response.json({ error: 'A valid session query parameter is required.' }, { status: 400 });
  }

  try {
    const binding = await getBindingStore().bySession(sessionId);
    return Response.json(
      binding
        ? {
            configured: true,
            bound: true,
            chatName: binding.chatName,
            muted: binding.muted,
            notified: binding.notified,
            boundAt: binding.boundAt,
          }
        : { configured: true, bound: false },
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

  const sessionId = sessionFrom(request);
  if (!sessionId || !validSession(sessionId)) {
    return Response.json({ error: 'A valid session query parameter is required.' }, { status: 400 });
  }

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
