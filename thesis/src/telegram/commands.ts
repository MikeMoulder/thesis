/**
 * What the bot says back.
 *
 * Kept away from the webhook route on purpose: the route is transport and
 * authentication, this is the conversation, and the conversation is the part
 * worth testing without a network.
 *
 * THE ONE PROMISE THIS COPY MAKES
 *
 * "Silence means nothing moved." Every reply that mentions alerts says some
 * version of it, because the product sends only on change and a user who does
 * not know that reads two quiet days as a broken bot. A notification channel
 * is trusted exactly as far as its silence is understood.
 */
import type { ThesisStore } from '../thesis/store';
import { summariseThesis } from '../thesis/types';
import type { BindingStore } from './bindings';
import { normaliseCode } from './bindings';
import { esc, type TelegramChat } from './client';

/** How the cron is configured on the VPS. Stated so /status can say it. */
const CADENCE_LABEL = 'every 15 minutes';

export interface CommandResult {
  /** HTML, ready to send. */
  reply: string;
  /** For the route's log line. Never includes the chat's content. */
  action: 'bound' | 'rejected' | 'muted' | 'resumed' | 'status' | 'help';
}

function ago(iso: string | undefined): string {
  if (!iso) return 'not yet';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return 'not yet';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** What Telegram gives us to call someone. Any of these can be absent. */
export function chatName(chat: TelegramChat): string {
  return chat.first_name ?? chat.title ?? (chat.username ? `@${chat.username}` : `chat ${chat.id}`);
}

const HELP = [
  '<b>THESIS</b>',
  '',
  'I watch investment theses and tell you when one breaks.',
  '',
  'To connect, open your desk and press <b>Send alerts to Telegram</b>.',
  'It shows a six character code. Send it here.',
  '',
  '<code>/bind CODE</code>  connect this chat to your desk',
  '<code>/status</code>     what I am watching',
  '<code>/stop</code>       pause alerts',
  '<code>/start</code>      resume alerts',
].join('\n');

/**
 * Everything under observation, newest first.
 *
 * Escaping happens once, in `table`, and nowhere else. Escaping per cell in
 * one place and per block in another is how a double-escaped "&amp;amp;"
 * eventually reaches a user.
 */
async function watching(theses: ThesisStore) {
  const all = await theses.list();
  return all.filter((t) => t.status !== 'retired').map(summariseThesis);
}

function table(rows: Array<{ ticker: string; health: string }>): string {
  const body = rows.map((r) => `  ${r.ticker.padEnd(6)} ${r.health}`).join('\n');
  return `<pre>${esc(body)}</pre>`;
}

export async function handleCommand(
  text: string,
  chat: TelegramChat,
  bindings: BindingStore,
  theses: ThesisStore,
): Promise<CommandResult> {
  const trimmed = text.trim();
  // Strip the @botname suffix Telegram appends in groups.
  const word = (trimmed.split(/\s+/)[0] ?? '').toLowerCase().replace(/@\w+$/, '');
  const existing = await bindings.byChat(chat.id);

  // -------------------------------------------------------------------------
  // /stop and /start, which are the same switch
  // -------------------------------------------------------------------------

  if (word === '/stop') {
    if (!existing) {
      return { reply: 'This chat is not connected to a desk, so there is nothing to pause.', action: 'help' };
    }
    await bindings.put({ ...existing, muted: true });
    return {
      reply: [
        '<b>Alerts paused.</b>',
        '',
        'I am still watching. I just will not message you.',
        'Send <code>/start</code> to resume.',
      ].join('\n'),
      action: 'muted',
    };
  }

  // -------------------------------------------------------------------------
  // Binding. /start carries the deep-link payload, /bind carries a typed code.
  // -------------------------------------------------------------------------

  if (word === '/start' || word === '/bind') {
    const code = normaliseCode(trimmed);

    // A bare /start from someone already bound is a resume, not a re-bind.
    if (!code) {
      if (existing?.muted) {
        await bindings.put({ ...existing, muted: false });
        return {
          reply: [
            '<b>Alerts resumed.</b>',
            '',
            `Watching ${(await watching(theses)).length} theses, re-checked ${CADENCE_LABEL}.`,
            'Silence means nothing moved.',
          ].join('\n'),
          action: 'resumed',
        };
      }
      if (existing) {
        return { reply: 'This chat is already connected. Send <code>/status</code> to see what I am watching.', action: 'status' };
      }
      return { reply: HELP, action: 'help' };
    }

    const bound = await bindings.redeem(code, chat.id, chatName(chat));
    if (!bound) {
      return {
        reply: [
          '<b>That code is not valid.</b>',
          '',
          'Codes expire after 10 minutes and work only once.',
          'Open your desk and press <b>Send alerts to Telegram</b> for a fresh one.',
        ].join('\n'),
        action: 'rejected',
      };
    }

    const rows = await watching(theses);
    return {
      reply: [
        '<b>Connected.</b>',
        '',
        rows.length
          ? `Watching ${rows.length} ${rows.length === 1 ? 'thesis' : 'theses'}, re-checked ${CADENCE_LABEL}:`
          : 'No theses under observation yet. Create one on the desk and I will pick it up.',
        ...(rows.length ? [table(rows)] : []),
        'I message you only when something <b>changes</b>: a tripwire fires, or an',
        'assumption moves between healthy, weakening and broken.',
        '',
        '<b>Silence means nothing moved.</b>',
        '',
        '<code>/status</code> what I am watching   <code>/stop</code> pause alerts',
      ].join('\n'),
      action: 'bound',
    };
  }

  // -------------------------------------------------------------------------
  // /status
  // -------------------------------------------------------------------------

  if (word === '/status') {
    if (!existing) {
      return {
        reply: [
          '<b>Not connected.</b>',
          '',
          'Open your desk and press <b>Send alerts to Telegram</b> for a code.',
        ].join('\n'),
        action: 'status',
      };
    }

    const all = await watching(theses);
    const lastChecked = all
      .map((s) => s.lastCheckedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop();

    return {
      reply: [
        `<b>Connected as ${esc(existing.chatName)}.</b>`,
        '',
        all.length ? table(all) : 'Nothing under observation yet.',
        `Checked ${CADENCE_LABEL}, last ${esc(ago(lastChecked))}.`,
        `Alerts sent to you: ${existing.notified}.`,
        existing.muted
          ? 'State: <b>paused</b>. Send <code>/start</code> to resume.'
          : 'State: active. Silence means nothing moved.',
      ].join('\n'),
      action: 'status',
    };
  }

  // -------------------------------------------------------------------------

  return { reply: HELP, action: 'help' };
}
