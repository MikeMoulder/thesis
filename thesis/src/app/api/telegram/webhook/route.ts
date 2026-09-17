import { getStore } from '@/thesis/store';
import { getBindingStore } from '@/telegram/bindings';
import { handleCommand, chatName } from '@/telegram/commands';
import { redact, sendMessage, type TelegramUpdate } from '@/telegram/client';

/**
 * Where Telegram delivers everything anyone sends the bot.
 *
 * THIS ENDPOINT ALWAYS RETURNS 200
 *
 * Even when the body is nonsense, even when the store is down, even when
 * handling throws. Telegram treats a non-2xx as a failed delivery and retries
 * with backoff, so a bug that returns 500 turns one bad message into a
 * retry storm, and a sustained one gets the webhook dropped. Errors are
 * reported to the user in chat and swallowed on the wire.
 *
 * The single exception is authentication. An unauthenticated caller gets 401,
 * because it is not Telegram and there is no delivery to acknowledge.
 *
 * AUTHENTICATION IS THE SECRET HEADER, AND THAT IS THE WHOLE MODEL
 *
 * The URL is public by necessity. Telegram signs nothing, so the only proof
 * an update is genuine is the secret handed to setWebhook, which comes back
 * in X-Telegram-Bot-Api-Secret-Token. Without checking it, anyone who guesses
 * this path can post a forged "/bind ABC234" and walk into someone's alerts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Telegram gives up on a slow webhook anyway. Fail fast and let it retry. */
export const maxDuration = 30;

function ok(): Response {
  // 200 with an empty object. Telegram accepts any 2xx and ignores the body
  // unless it names a method, which this route deliberately never does.
  return Response.json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.TG_WEBHOOK_SECRET ?? '';
  if (!expected) {
    // Refuse rather than default to open, exactly as /api/recheck does. A
    // misconfigured deploy that silently accepts every caller is worse than
    // one that visibly does nothing.
    return Response.json(
      { error: 'TG_WEBHOOK_SECRET is not set on this deployment.' },
      { status: 503 },
    );
  }

  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (provided !== expected) {
    return Response.json({ error: 'Not Telegram.' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    // Acknowledge it. A malformed body will be malformed on every retry.
    return ok();
  }

  const message = update.message ?? update.edited_message;
  const chat = message?.chat;
  const text = message?.text;

  // Anything without text is not a command. Photos, stickers and people
  // joining a group all arrive here and all mean nothing to this bot.
  if (!chat || !text) return ok();

  try {
    const result = await handleCommand(text, chat, getBindingStore(), getStore());
    const sent = await sendMessage(chat.id, result.reply);

    // Logged without the user's message text. The command word is operational
    // data; what someone typed into a private chat is not ours to print.
    console.log(
      `[telegram] ${result.action} chat=${chat.id} name=${chatName(chat)} ` +
        `delivered=${sent.ok ? 'yes' : `no (${sent.error})`}`,
    );
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error));
    console.error(`[telegram] handler failed chat=${chat.id}: ${detail}`);

    // Tell the user something went wrong rather than leaving them staring at
    // a bot that read their message and said nothing. Best effort: if this
    // send fails too, there is nothing further to try.
    await sendMessage(
      chat.id,
      '<b>Something went wrong on my side.</b>\n\nThe desk is still watching. Try again in a moment.',
    ).catch(() => undefined);
  }

  return ok();
}

/**
 * A GET here is a person pasting the webhook URL into a browser to see if it
 * is alive. Say so, and say nothing about whether the secret is configured.
 */
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    detail: 'Telegram webhook endpoint. It accepts POSTs from Telegram only.',
  });
}
