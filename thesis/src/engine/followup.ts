import type { Evaluation } from './breakers/evaluate';
import { PERCENT_METRICS, type BreakerSet } from './breakers/types';
import type { Decomposition } from './decomposer/types';
import { getLlm } from '../llm/index';

/**
 * Answer a follow-up question about a completed run.
 *
 * The one rule that matters: the model may use ONLY what the run produced. A
 * research tool whose chat window quietly invents a number it did not retrieve
 * is worse than no chat window, because everything else on the page is cited
 * and the prose inherits that credibility without having earned it.
 *
 * So the context handed over is the run's own structured output, and the prompt
 * makes "I cannot answer that from this analysis" the correct response rather
 * than a failure. That sentence is useful output here, exactly as it is when the
 * decomposer marks an assumption untestable.
 */

const SYSTEM = `You answer questions about a completed THESIS analysis.

THESIS takes a trader's own thesis, breaks it into assumptions, and builds
tripwires — stored conditions that would tell the trader the thesis has broken.

ABSOLUTE RULES

1. Use ONLY the analysis JSON provided. It is the entire world.
2. Never introduce a number, date, filing, price or fact that is not in it.
3. If the question cannot be answered from it, say so plainly and say what
   would be needed. That is a correct answer, not a failure.
4. Never tell the user what to trade, never suggest a position or a size, and
   never predict a price. If asked, say that THESIS does not do that and
   redirect to what the analysis does show.
5. Refer to assumptions and tripwires by their ids (A1, B2) so the reader can
   find them on the page.

STYLE
Plain sentences. Two short paragraphs at most. No headings, no bullet lists,
no markdown. You are speaking, not producing a document.`;

/** Trim the run down to what a question could reasonably need. */
function buildContext(
  decomposition: Decomposition,
  breakerSet?: BreakerSet,
  evaluations?: Evaluation[],
): string {
  return JSON.stringify(
    {
      ticker: decomposition.ticker,
      thesis: decomposition.thesis,
      horizon: decomposition.horizon,
      claims: decomposition.claims,
      assumptions: decomposition.assumptions.map((a) => ({
        id: a.id,
        statement: a.statement,
        origin: a.origin,
        loadBearing: a.loadBearing,
        testability: a.testability,
        dataNeeded: a.dataNeeded,
        rationale: a.rationale,
      })),
      ambiguities: decomposition.ambiguities,
      tripwires: breakerSet?.breakers.map((b) => ({
        id: b.id,
        tests: b.assumptionRef,
        statement: b.statement,
        condition:
          b.kind === 'threshold'
            ? `${b.metric} ${b.operator} ${b.threshold}${PERCENT_METRICS.has(b.metric) ? '%' : ''}`
            : `watch for: ${b.watchFor}`,
        cadence: b.cadence,
        severity: b.severity,
        severityIsInherited: b.severityInherited,
      })),
      assumptionsWithNoTripwire: breakerSet?.uncovered,
      currentReadings: evaluations?.map((e) => ({
        tripwire: e.breakerId,
        status: e.status,
        observed: e.observed,
        threshold: e.threshold,
        headroom: e.headroom,
        asOf: e.asOf,
        period: e.period,
        source: e.provenance?.source,
        whyUnknown: e.reason,
      })),
      dataThisSystemCannotReach: [
        'analyst consensus and price targets',
        'forward earnings estimates and valuation multiples',
        'segment-level revenue or margin breakouts',
        'market share',
        'industry research reports',
        'management intent or private guidance',
        'news and headlines (no news feed is wired)',
      ],
    },
    null,
    1,
  );
}

export interface FollowupAnswer {
  text: string;
  model: string;
  latencyMs: number;
}

export async function answerFollowup(
  question: string,
  decomposition: Decomposition,
  breakerSet?: BreakerSet,
  evaluations?: Evaluation[],
): Promise<FollowupAnswer> {
  const llm = getLlm('followup');
  const context = buildContext(decomposition, breakerSet, evaluations);

  const result = await llm.complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `ANALYSIS\n${context}\n\nQUESTION\n${question}` },
    ],
    { temperature: 0.2, maxTokens: 500 },
  );

  return {
    text: result.text.trim(),
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
