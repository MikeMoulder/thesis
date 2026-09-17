import { getDataSource } from '@/data/index';
import type { BreakerSet } from '@/engine/breakers/types';
import { describeStress, runStressPresets, STRESS_PRESETS, worstCase } from '@/engine/stress';

/**
 * Run the preset stress tests against a thesis.
 *
 * POST because the breaker set travels in the body: it is the analysis the
 * client already has on screen, and putting it in a query string would be both
 * enormous and a record of what somebody believes about a trade in every log
 * between here and them.
 *
 * NO MODEL CALLS. This runs the stored breakers against hypothetical values,
 * which is the same evaluator the live monitor uses pointed somewhere else.
 * That is the return on keeping breakers as structured conditions rather than
 * prose: six stress tests cost six comparisons, so the panel is free and can
 * run on load rather than on request.
 *
 * GET returns the catalogue, so the presets can be listed and explained before
 * anyone has an analysis to run them against.
 */

export const runtime = 'nodejs'; // readMetric reaches the Bitget SDK
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(): Response {
  return Response.json({
    presets: STRESS_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      question: p.question,
      rationale: p.rationale,
      needs: p.needs,
    })),
  });
}

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let body: { ticker?: unknown; breakerSet?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Body must be JSON.');
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return bad('ticker must be 1–10 letters, e.g. NVDA.');

  const breakerSet = body.breakerSet as BreakerSet | undefined;
  if (!breakerSet?.breakers?.length) return bad('No tripwires to stress test yet.');

  const ds = getDataSource();
  try {
    const instrument = await ds.resolve(ticker);
    const report = await runStressPresets(ds, instrument, breakerSet);
    const worst = worstCase(report);

    return Response.json(
      {
        ticker,
        modelCalls: 0,
        current: report.current,
        results: report.results.map((r) => ({
          id: r.preset.id,
          label: r.preset.label,
          question: r.preset.question,
          rationale: r.preset.rationale,
          scenario: r.scenario,
          summary: describeStress(r, report.current),
          firedCount: r.firedCount,
          evaluations: r.evaluations,
        })),
        // Reported rather than dropped: a preset that could not run is a gap in
        // the stress test, and a panel that quietly shows five of six rows has
        // told the user their thesis survived a shock nobody applied.
        skipped: report.skipped.map((s) => ({
          id: s.preset.id,
          label: s.preset.label,
          reason: s.reason,
        })),
        worst: worst ? { id: worst.preset.id, firedCount: worst.firedCount } : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Stress test failed.' },
      { status: 502 },
    );
  }
}
