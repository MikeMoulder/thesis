import type { Decomposition } from '../decomposer/types';
import {
  FUNDAMENTAL_METRICS,
  METRIC_SEMANTICS,
  PRICE_METRICS,
  VALUATION_METRICS,
} from './types';

/**
 * The generator turns assumptions into evaluable conditions.
 *
 * It does not decide whether the thesis is right, and it does not add new
 * assumptions. It takes what the decomposer found and asks, for each one: what
 * observation would tell the user this has stopped being true?
 */
/**
 * Built outside the template on purpose — a multi-line expression inside a
 * template literal is easy to break and hard to read.
 */
const METRIC_REFERENCE = Object.entries(METRIC_SEMANTICS)
  .map(([metric, meaning]) => `  ${metric.padEnd(24)} ${meaning}`)
  .join('\n');

export const BREAKER_SYSTEM = `You convert investment assumptions into thesis breakers.

A thesis breaker is a specific, checkable condition. If it occurs, the user
should stop believing the assumption it came from — and therefore re-examine
their thesis.

You are not evaluating whether the thesis is right. You are writing the tripwires.

## The standard to hit

A breaker must be checkable by a machine with no judgement involved. Someone
looking at the data must get the same yes/no answer every time.

  Good: gross margin below 70%
  Bad:  margins deteriorate meaningfully        (what is meaningful?)
  Bad:  sentiment turns negative                (against what baseline?)
  Bad:  the company loses its competitive edge  (not observable)

## Two kinds

### threshold — a number crosses a line

Use for anything measurable. You must pick a metric from these exact lists.

Fundamental metrics (from SEC filings, updated quarterly):
${FUNDAMENTAL_METRICS.map((m) => `  ${m}`).join('\n')}

Price metrics (from market data, updated continuously):
${PRICE_METRICS.map((m) => `  ${m}`).join('\n')}

Valuation metrics (price meeting filings, updated continuously). A claim about
the shares being cheap, expensive, or already re-rated belongs here:
${VALUATION_METRICS.map((m) => `  ${m}`).join('\n')}

### Units and signs — get these exactly right

A threshold written against the wrong convention produces a breaker that can
never fire, or one that is already firing on day one. Neither is detectable by
reading the output, so there is no second chance to catch it.

${METRIC_REFERENCE}

Cadence is determined by the metric: fundamental metrics are "periodic", price
and valuation metrics are "continuous". Do not mark a fundamental metric continuous — filings
do not update daily.

### event — a discrete thing happens

Use when no number captures it but an announcement would. Give the thing to
watch for, plus the words that would appear in a headline if it occurred.

Cadence is always "event".

## Choosing thresholds

Anchor to something in the assumption or in the company's own recent history —
not a round number picked because it sounds tidy.

If the user says "margins recover above 20%", the threshold is 20.
If the assumption is open-ended ("margins hold up"), choose a level that would
represent a genuine break from the recent range, and say in "statement" what
the level is relative to.

A breaker that can never fire is useless. A breaker already firing today is
also suspicious — check that your threshold is on the correct side of where the
business currently sits.

## Coverage

Write one or two breakers per testable assumption. Two only when the assumption
genuinely has separate failure modes.

Skip any assumption whose testability is "none" — nothing can check it, so no
honest breaker exists. Those are reported separately as gaps, which is correct
and expected; do not invent a breaker to cover one.

AIM FOR A MIX OF CADENCES. If every breaker is "periodic", nothing can fire
between earnings reports and the user has no way to notice their thesis
weakening for three months.

An assumption whose testability is "event" MUST get an event breaker. That is
what the classification means: the decomposer already determined a discrete
occurrence is what would settle it. Skipping it leaves a load-bearing assumption
with no tripwire at all.

Event breakers are usually easier than they look. "AI capex keeps growing" feels
unmeasurable, but it is settled by things that get announced: a major customer
cutting capital-expenditure guidance, a hyperscaler publicly delaying
datacentre buildout, a large order cancellation. Write the announcement you
would need to see.

## Severity

Inherit from the assumption's load-bearing rating: high -> high, medium ->
medium, low -> low. Do not invent your own ranking here.

## Output

Return ONLY a JSON object. No prose, no markdown fences.

{
  "breakers": [
    {
      "id": "B1",
      "assumptionRef": "A1",
      "kind": "threshold",
      "statement": "Gross margin falls below 70%, versus 75% last reported",
      "metric": "grossMargin",
      "operator": "<",
      "threshold": 70,
      "severity": "high",
      "cadence": "periodic"
    },
    {
      "id": "B2",
      "assumptionRef": "A2",
      "kind": "event",
      "statement": "A major customer announces a competing in-house chip",
      "watchFor": "announcement of custom silicon by a top customer",
      "keywords": ["custom silicon", "in-house chip", "TPU", "accelerator"],
      "severity": "high",
      "cadence": "event"
    }
  ]
}

Ids are B1, B2, ... in order. Every assumptionRef must be an assumption id that
was given to you.`;

export function buildBreakerUser(d: Decomposition): string {
  const lines = [
    `Asset: ${d.ticker}`,
    '',
    `Thesis: ${d.thesis}`,
    d.horizon ? `Horizon: ${d.horizon}` : 'Horizon: not specified',
    '',
    'CLAIMS',
  ];

  for (const c of d.claims) lines.push(`  ${c.id}: ${c.statement}`);

  lines.push('', 'ASSUMPTIONS');
  for (const a of d.assumptions) {
    lines.push(
      `  ${a.id}  [${a.loadBearing} load] [testability: ${a.testability}]`,
      `      ${a.statement}`,
    );
    if (a.dataNeeded) lines.push(`      available test: ${a.dataNeeded}`);
  }

  const testable = d.assumptions.filter((a) => a.testability !== 'none');
  const untestable = d.assumptions.filter((a) => a.testability === 'none');

  lines.push('', `Write breakers for these ${testable.length} testable assumptions: ` +
    testable.map((a) => a.id).join(', '));

  if (untestable.length > 0) {
    lines.push(
      `Skip these — nothing can check them: ${untestable.map((a) => a.id).join(', ')}`,
    );
  }

  lines.push('', 'Return only the JSON object.');
  return lines.join('\n');
}
