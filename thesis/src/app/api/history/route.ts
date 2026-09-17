import { getDataSource } from '@/data/index';
import { evaluateHistorical } from '@/engine/breakers/evaluate';
import {
  FUNDAMENTAL_METRICS,
  PRICE_METRICS,
  type Metric,
  type Operator,
  type ThesisBreaker,
} from '@/engine/breakers/types';

/**
 * Base rates for one tripwire: when this condition held before, what followed?
 *
 * A separate request rather than part of the main run, because it is expensive
 * — ten years of filings plus the full price history, per breaker — and it sits
 * behind a disclosure in the UI. Paying for it on every run would slow the
 * thing everybody sees to fund the thing most people never open.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const OPERATORS: Operator[] = ['<', '<=', '>', '>='];
const METRICS = new Set<string>([...FUNDAMENTAL_METRICS, ...PRICE_METRICS]);

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Rebuild the breaker from the request rather than trusting the body's shape.
 *
 * The client sends back a breaker the server generated, but it arrives over the
 * wire and the evaluator will happily compute against whatever it is handed. A
 * metric outside the closed vocabulary or a non-numeric threshold produces
 * nonsense rather than an error, so both are checked here.
 */
function parseBreaker(input: unknown): ThesisBreaker | string {
  if (typeof input !== 'object' || input === null) return 'breaker must be an object';
  const b = input as Record<string, unknown>;

  if (b.kind === 'event') return 'event breakers have no numeric base rate';
  if (typeof b.id !== 'string' || !b.id) return 'breaker.id is required';
  if (typeof b.metric !== 'string' || !METRICS.has(b.metric)) {
    return `unknown metric: ${String(b.metric)}`;
  }
  if (typeof b.operator !== 'string' || !OPERATORS.includes(b.operator as Operator)) {
    return `unknown operator: ${String(b.operator)}`;
  }
  if (typeof b.threshold !== 'number' || !Number.isFinite(b.threshold)) {
    return 'threshold must be a finite number';
  }

  return {
    id: b.id,
    kind: 'threshold',
    assumptionRef: typeof b.assumptionRef === 'string' ? b.assumptionRef : '',
    statement: typeof b.statement === 'string' ? b.statement : '',
    metric: b.metric as Metric,
    operator: b.operator as Operator,
    threshold: b.threshold,
    severity: b.severity === 'high' || b.severity === 'low' ? b.severity : 'medium',
    severityInherited: b.severityInherited !== false,
    cadence: b.cadence === 'continuous' ? 'continuous' : 'periodic',
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: { ticker?: unknown; breaker?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Body must be JSON.');
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return bad('ticker must be 1-10 letters.');

  const breaker = parseBreaker(body.breaker);
  if (typeof breaker === 'string') return bad(breaker);

  try {
    const ds = getDataSource();
    const instrument = await ds.resolve(ticker);
    const result = await evaluateHistorical(ds, instrument, breaker);

    // evaluateHistorical returns an Evaluation instead of evidence when it
    // cannot build a base rate. That is an answer, not a failure.
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
