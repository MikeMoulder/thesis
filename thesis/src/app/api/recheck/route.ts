import { timingSafeEqual } from 'node:crypto';

import { getDataSource } from '@/data/index';
import { deliverAlerts } from '@/telegram/alerts';
import { getBindingStore } from '@/telegram/bindings';
import { recheckAll } from '@/thesis/recheck';
import { getStore, storeStatus } from '@/thesis/store';

/**
 * The 24/7 endpoint. Something outside this app calls it on a schedule.
 *
 * Guarded by a shared secret rather than left open, because an open recheck
 * endpoint is a free way for a stranger to hammer SEC and Yahoo from our IP
 * until they throttle us, and to fill every user's check log with noise.
 *
 * GET and POST both work. POST is the honest verb — this mutates — but many
 * schedulers and uptime pingers only send GET, and refusing them would trade a
 * working demo for a point of REST etiquette.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Leave room for the response to be written before the platform cuts us off. */
const BUDGET_MS = 55_000;

/**
 * Constant-time comparison. A plain `===` leaks the secret one character at a
 * time to anyone patient enough to measure the difference.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorise(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.RECHECK_SECRET ?? '';

  if (!expected) {
    // Refuse rather than default to open. A misconfigured deploy that silently
    // accepts everyone is worse than one that visibly does nothing.
    return {
      ok: false,
      status: 503,
      error: 'RECHECK_SECRET is not set on this deployment, so the recheck endpoint is disabled.',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Vercel Cron sends its own header; accept it too so the same endpoint works
  // if this ever moves off an external scheduler.
  const provided = bearer || new URL(request.url).searchParams.get('key') || '';

  if (!provided || !secretMatches(provided, expected)) {
    return { ok: false, status: 401, error: 'Bad or missing recheck secret.' };
  }
  return { ok: true };
}

async function run(request: Request): Promise<Response> {
  const auth = authorise(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const store = storeStatus();
  if (!store.persisted) {
    // Rechecking an in-memory store would append to a log that dies with this
    // instance, and report success for work nobody will ever see.
    return Response.json(
      { error: 'Refusing to recheck: no persistent store is configured.', store },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  const only = url.searchParams.get('only');

  try {
    const report = await recheckAll(getStore(), getDataSource(), {
      force,
      ...(only ? { only } : {}),
      deadline: Date.now() + BUDGET_MS,
    });

    /*
      Telegram is delivered AFTER the checks are written, never before and
      never instead. The check is the product and it is already durable by
      this line; notification is the reachable half. deliverAlerts never
      throws for the same reason, and this catch is the second layer of the
      same argument rather than a redundancy.

      A quiet tick does no work at all: buildAlerts returns an empty list
      before the binding store is ever read.
    */
    let telegram;
    try {
      telegram = await deliverAlerts(report, getBindingStore(), url.origin);
    } catch (error) {
      telegram = { error: error instanceof Error ? error.message : String(error) };
    }

    return Response.json(
      { ...report, telegram },
      {
        // Never let a CDN or a scheduler's proxy serve a stale report.
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}
