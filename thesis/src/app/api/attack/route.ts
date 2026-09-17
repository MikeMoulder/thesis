import { runAttack, type RunEvent } from '@/engine/run';

/**
 * Streams one ATTACK MY THESIS run as Server-Sent Events.
 *
 * POST rather than GET, so `EventSource` is not usable on the client: a thesis
 * is free text of arbitrary length and belongs in a body, not a query string.
 * The client reads the response stream and parses SSE frames itself, which is a
 * few lines and avoids putting what someone believes about a trade into a URL
 * that lands in logs and history.
 */

export const runtime = 'nodejs'; // the Bitget SDK and the fs-backed quota counter need Node
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface AttackBody {
  ticker?: unknown;
  thesis?: unknown;
  horizon?: unknown;
}

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let body: AttackBody;
  try {
    body = (await request.json()) as AttackBody;
  } catch {
    return bad('Body must be JSON.');
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  const thesis = typeof body.thesis === 'string' ? body.thesis.trim() : '';
  const horizon = typeof body.horizon === 'string' ? body.horizon.trim() : '';

  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return bad('ticker must be 1–10 letters, e.g. NVDA.');
  if (thesis.length < 20) return bad('Give me a thesis to attack — a sentence or two.');
  if (thesis.length > 2000) return bad('Thesis is too long; keep it under 2000 characters.');

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of runAttack({
          ticker,
          thesis,
          ...(horizon ? { horizon } : {}),
        })) {
          send(event);
        }
      } catch (error) {
        // The generator handles its own expected failures; anything reaching
        // here is unexpected, and the client still needs to be told rather than
        // left watching a stream that simply stops.
        send({
          type: 'error',
          kind: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer would defeat the point of streaming entirely.
      'x-accel-buffering': 'no',
    },
  });
}
