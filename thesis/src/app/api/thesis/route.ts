import { runAttack, type RunEvent } from '@/engine/run';
import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Decomposition } from '@/engine/decomposer/types';
import { createThesis, thesisId } from '@/thesis/record';
import { getStore, storeStatus } from '@/thesis/store';
import { summariseThesis, type ThesisRecord } from '@/thesis/types';

/**
 * Create a thesis, and list the ones that exist.
 *
 * POST streams the run as Server-Sent Events exactly as `/api/attack` did — the
 * pipeline takes the better part of ten seconds and the assumption tree is
 * worth showing before a single tripwire exists — and then writes the finished
 * thesis to the store and emits one extra frame carrying it.
 *
 * The engine is not touched. `runAttack` stays transport-agnostic and knows
 * nothing about storage; persistence is this route's job, which is why the
 * `saved` frame is defined here rather than added to `RunEvent`.
 */

export const runtime = 'nodejs'; // the Bitget SDK and the fs-backed quota counter need Node
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** What the client reads: every run event, plus the one this route adds. */
export type ThesisStreamEvent =
  | RunEvent
  | { type: 'saved'; thesis: ThesisRecord }
  | { type: 'savefailed'; message: string };

interface CreateBody {
  ticker?: unknown;
  thesis?: unknown;
  horizon?: unknown;
}

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  try {
    const theses = await getStore().list();
    return Response.json({
      theses: theses.map(summariseThesis),
      store: storeStatus(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return bad('Body must be JSON.');
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  const statement = typeof body.thesis === 'string' ? body.thesis.trim() : '';
  const horizon = typeof body.horizon === 'string' ? body.horizon.trim() : '';

  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return bad('ticker must be 1–10 letters, e.g. NVDA.');
  if (statement.length < 20) return bad('Give me a thesis — a sentence or two, with your reasoning.');
  if (statement.length > 2000) return bad('Thesis is too long; keep it under 2000 characters.');

  const encoder = new TextEncoder();
  const id = thesisId(ticker);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ThesisStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let decomposition: Decomposition | null = null;
      let breakerSet: BreakerSet | null = null;
      let evaluations: Evaluation[] = [];
      let modelCalls = 0;

      try {
        for await (const event of runAttack({
          ticker,
          thesis: statement,
          ...(horizon ? { horizon } : {}),
        })) {
          // Capture as it streams rather than re-running anything at the end.
          if (event.type === 'decomposition') decomposition = event.decomposition;
          if (event.type === 'breakers') breakerSet = event.breakerSet;
          if (event.type === 'evaluations') evaluations = event.evaluations;
          if (event.type === 'done') modelCalls = event.modelCalls;
          send(event);
        }

        // A run that failed before producing breakers has nothing to keep under
        // observation. Saving a half-built thesis would put a permanently
        // unhealthy card on the list that no recheck could ever resolve.
        if (!decomposition || !breakerSet) {
          send({
            type: 'savefailed',
            message: 'The run did not get far enough to create a thesis. Nothing was saved.',
          });
          return;
        }

        const thesis = createThesis({
          id,
          ticker,
          statement,
          decomposition,
          breakerSet,
          evaluations,
          modelCalls,
        });

        try {
          await getStore().put(thesis);
          send({ type: 'saved', thesis });
        } catch (error) {
          // The analysis on screen is still real and still worth reading, so
          // this is reported as a failure to REMEMBER rather than a failed run.
          send({
            type: 'savefailed',
            message: `The analysis ran, but could not be saved: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } catch (error) {
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
