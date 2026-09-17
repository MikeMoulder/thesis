'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Where the 24/7 loop reaches a person.
 *
 * The cron has re-checked every thesis every fifteen minutes since the 16th.
 * Until this existed, a tripwire firing at 3am waited for somebody to open a
 * browser, which made "fourteen days of notice" a measurement nobody received.
 *
 * WHY IT SITS ABOVE THE SOURCE HEALTH ROW
 *
 * Those two lines answer the same question from opposite ends: is the watching
 * actually working. Health says the sources are up, this says the answer can
 * reach you. An alerts control filed under settings would be a feature; here
 * it reads as part of the promise.
 *
 * THE SESSION ID IS A BROWSER IDENTITY, NOT A USER ACCOUNT
 *
 * There are no accounts in this product. The id is a random string in
 * localStorage whose only job is to let the desk ask "has my code been
 * redeemed yet". It is never a chat id, and the desk is never told one: a
 * browser that could name a chat could subscribe it without asking, and the
 * code exists so the person holding the Telegram account is the one who says
 * yes.
 */

const SESSION_KEY = 'thesis.telegram.session.v1';

/** Fast enough to feel instant when the user comes back from Telegram. */
const POLL_MS = 2_500;

/** Codes live ten minutes. Stop polling well before that, not after. */
const POLL_LIMIT_MS = 10 * 60 * 1000;

interface Status {
  configured: boolean;
  bound: boolean;
  chatName?: string;
  muted?: boolean;
  notified?: number;
}

interface Pending {
  code: string;
  deepLink: string | null;
  bot: string | null;
}

/**
 * A stable id for this browser.
 *
 * Every access is guarded. Storage throws in private windows and comes back
 * empty once site data is cleared, and the control has to render either way:
 * without an id it simply cannot offer to bind, which is a correct outcome
 * rather than a crash.
 */
function loadSession(): string | null {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function TelegramBind() {
  const [session, setSession] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(0);

  // Read on mount rather than in the initial state, so the server render and
  // the first client render agree. The same reason the panel does it.
  useEffect(() => setSession(loadSession()), []);

  const refresh = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/telegram/bind?session=${encodeURIComponent(id)}`);
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok) {
        setStatus({ configured: data.configured ?? false, bound: false });
        return false;
      }
      setStatus(data);
      return Boolean(data.bound);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (session) void refresh(session);
  }, [session, refresh]);

  // Poll only while a code is outstanding. A control that polls forever is a
  // request every 2.5 seconds for the whole time a tab is open, on a page a
  // user may leave running all day.
  useEffect(() => {
    if (!session || !pending) return;
    startedAt.current = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) {
        setPending(null);
        return;
      }
      void refresh(session).then((bound) => {
        if (bound) setPending(null);
      });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [session, pending, refresh]);

  const connect = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/telegram/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session }),
      });
      const data = (await response.json()) as Pending & { configured?: boolean };
      if (response.ok && data.code) {
        setPending({ code: data.code, deepLink: data.deepLink ?? null, bot: data.bot ?? null });
      } else {
        setStatus({ configured: data.configured ?? false, bound: false });
      }
    } catch {
      // Leave the control as it was. A failed mint is retried by pressing again.
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/telegram/bind?session=${encodeURIComponent(session)}`, { method: 'DELETE' });
      setStatus({ configured: true, bound: false });
      setPending(null);
    } catch {
      // Same as above: the row still shows connected, and pressing again retries.
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked without a user gesture in some browsers. The code
      // is on screen and can be typed, which is what it is sized for.
    }
  };

  // Not configured on this deployment. Say nothing rather than offer a button
  // that cannot work: an alerts control that fails is worse than no control.
  if (status && !status.configured) return null;
  if (!session) return null;

  // -------------------------------------------------------------------------

  if (status?.bound) {
    return (
      <div className="flex items-center gap-2.5 px-3 pt-2">
        <Send aria-hidden className="size-3 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-meta leading-tight text-faint">
          {status.muted ? 'Alerts paused in Telegram' : `Alerts to ${status.chatName}`}
        </span>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="shrink-0 text-meta text-faint underline-offset-2 hover:text-text hover:underline disabled:opacity-50"
        >
          disconnect
        </button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-1.5 px-3 pt-2">
        <p className="text-meta leading-tight text-faint">
          {pending.deepLink ? 'Open the bot, or send this code to ' : 'Send this code to '}
          <span className="text-muted">{pending.bot ?? 'the bot'}</span>
        </p>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={copy}
            title="Copy the code"
            className={cn(
              'rounded-pill border border-line px-2 py-1 font-mono text-sm tracking-[0.2em] text-text',
              'hover:border-line-strong',
            )}
          >
            {pending.code}
          </button>
          {copied ? <Check aria-hidden className="size-3 shrink-0 text-trust" /> : null}
        </div>

        {pending.deepLink ? (
          <a
            href={pending.deepLink}
            target="_blank"
            rel="noreferrer"
            className="block text-meta text-trust underline-offset-2 hover:underline"
          >
            Open Telegram
          </a>
        ) : null}

        <p className="text-meta leading-tight text-faint">Waiting. Expires in 10 minutes.</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={busy}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 pt-2 text-left',
        'text-meta leading-tight text-faint hover:text-text disabled:opacity-50',
      )}
    >
      <Send aria-hidden className="size-3 shrink-0" />
      <span>{busy ? 'getting a code…' : 'Send alerts to Telegram'}</span>
    </button>
  );
}
