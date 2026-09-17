import { getDataSource } from '@/data/index';
import { evaluateLive, type Evaluation } from '@/engine/breakers/evaluate';
import { readMetric } from '@/engine/breakers/metrics';
import type { BreakerSet } from '@/engine/breakers/types';
import { deriveSignal } from '@/engine/signal';
import { buildTicket } from '@/engine/ticket';

/**
 * Derive a signal from a thesis that is already on screen.
 *
 * POST because the breaker set travels in the body, same as /api/stress: it is
 * the analysis the client already holds, and a query string would be both
 * enormous and a record of somebody's position in every log between here and
 * them.
 *
 * NO MODEL CALLS. Every number returned is a rearrangement of readings this
 * engine already takes. See src/engine/signal.ts for why that distinction is
 * the whole point rather than an optimisation.
 *
 * ## Why the breakers are re-evaluated here rather than trusted from the body
 *
 * The client has evaluations on screen from whenever the run happened. A stop
 * level derived from a twenty minute old price is a wrong stop, stated to two
 * decimal places. The readings are cheap and carry no model cost, so they are
 * taken again at the moment the signal is asked for, and the price everything
 * anchors to is read in the same pass.
 */

export const runtime = 'nodejs'; // readMetric reaches the Bitget SDK
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

const DIRECTIONS = ['bullish', 'bearish', 'neutral'] as const;
type Direction = (typeof DIRECTIONS)[number];

export async function POST(request: Request): Promise<Response> {
  let body: { ticker?: unknown; direction?: unknown; breakerSet?: unknown; thesisId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Body must be JSON.');
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return bad('ticker must be 1-10 letters, e.g. NVDA.');

  const direction: Direction = DIRECTIONS.includes(body.direction as Direction)
    ? (body.direction as Direction)
    : 'bullish';

  const breakerSet = body.breakerSet as BreakerSet | undefined;
  if (!breakerSet?.breakers?.length) {
    return bad('No tripwires on this thesis yet, so there is nothing to derive a signal from.');
  }

  const ds = getDataSource();

  try {
    const instrument = await ds.resolve(ticker);

    /*
      Price, depth and exit cost are read DIRECTLY rather than lifted out of
      the breaker evaluations. A thesis need not carry a price tripwire or a
      liquidity tripwire, and both live theses carry neither, so scanning the
      evaluations for them left the most valuable number in a signal missing
      from every real case. Whether a position can be closed is a fact about
      the instrument, not about what the user happened to write down.

      Each is independently optional. A failure to read one must not cost the
      others, so they resolve separately and a rejection becomes null.
    */
    const read = async (metric: 'price' | 'exitDepthUsd' | 'exitSlippageBps') => {
      try {
        return (await readMetric(ds, instrument, metric)).value;
      } catch {
        return null;
      }
    };

    const [price, exitDepthUsd, exitSlippageBps] = await Promise.all([
      read('price'),
      read('exitDepthUsd'),
      read('exitSlippageBps'),
    ]);

    // Re-evaluated in parallel. Serially these are four to six round trips on
    // a request a user is waiting on with a button still depressed.
    const evaluations: Evaluation[] = await Promise.all(
      breakerSet.breakers.map(async (breaker) => {
        try {
          return await evaluateLive(ds, instrument, breaker);
        } catch (error) {
          // evaluateLive converts most failures itself; this covers the rest,
          // because one unreadable metric must not cost the whole signal.
          return {
            breakerId: breaker.id,
            mode: 'live',
            status: 'undeterminable',
            reason: error instanceof Error ? error.message : String(error),
          } as Evaluation;
        }
      }),
    );

    const signal = deriveSignal({
      ticker,
      direction,
      breakerSet,
      evaluations,
      price,
      exitDepthUsd,
      exitSlippageBps,
      rTokenSymbol: instrument.rTokenSymbol ?? null,
    });

    /*
      The ticket is built here rather than in a second request. Every number it
      needs is already in hand, and a separate round trip would re-read the
      price and produce an order priced a few seconds away from the size cap
      shown beside it.

      It needs the venue's own rules, which is why the registry now carries
      them. Without `rules` no order can be checked before it is handed over,
      and an order that fails on a decimal place in front of a judge is worse
      than no order at all.
    */
    const ticket = instrument.rules
      ? buildTicket({
          signal,
          rules: instrument.rules,
          thesisId: typeof body.thesisId === 'string' ? body.thesisId : ticker.toLowerCase(),
        })
      : null;

    return Response.json(
      { ...signal, ticket, modelCalls: 0 },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Signal derivation failed.' },
      { status: 502 },
    );
  }
}
