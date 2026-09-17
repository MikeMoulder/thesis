import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet, ThesisBreaker } from '@/engine/breakers/types';
import type { Provenance } from '@/data/types';
import type { Decomposition } from '@/engine/decomposer/types';
import { summarise } from '@/engine/decomposer/types';

/**
 * Fixture for the component lab. NOT engine output.
 *
 * The shape is faithful — it mirrors a real run recorded in HANDOFF.md
 * (5 assumptions, 3 verifiable, 2 high / 2 medium / 1 low, with A1 and A2
 * load-bearing and untestable, covered by B1–B3). Component work needs
 * deterministic input, and burning judge-model quota to render a layout would
 * be absurd.
 *
 * It must never be imported by the product. If a fixture ever reaches a user it
 * becomes a fabricated analysis, which is the one thing this system exists to
 * prevent.
 */

const claims = [
  {
    id: 'C1',
    statement:
      'NVIDIA outperforms over the next two quarters as AI infrastructure spending continues.',
    direction: 'bullish' as const,
  },
];

const assumptions = [
  {
    id: 'A1',
    statement: 'The market has not already priced in the current pace of AI infrastructure spend.',
    origin: 'implicit' as const,
    supports: ['C1'],
    loadBearing: 'high' as const,
    testability: 'none' as const,
    dataNeeded:
      'Would require analyst consensus and forward multiples, which this system cannot reach.',
    rationale:
      'The step from "the trend continues" to "therefore the stock rises" assumes the trend is not already in the price. It is never stated and it carries the whole thesis.',
  },
  {
    id: 'A2',
    statement: 'NVIDIA retains its current share of accelerator spending rather than losing it to competitors or in-house silicon.',
    origin: 'implicit' as const,
    supports: ['C1'],
    loadBearing: 'high' as const,
    testability: 'none' as const,
    dataNeeded: 'Would require market share and segment data not present in filings.',
    rationale: 'A rising market does not lift this particular company unless it keeps its position.',
  },
  {
    id: 'A3',
    statement: 'Gross margin holds above 70% as the product mix shifts.',
    origin: 'implicit' as const,
    supports: ['C1'],
    loadBearing: 'medium' as const,
    testability: 'fundamental' as const,
    dataNeeded: 'Quarterly gross profit and revenue from 10-Q filings.',
    rationale: 'Margin compression would offset revenue growth in the earnings that drive the move.',
  },
  {
    id: 'A4',
    statement: 'Revenue growth stays above 30% year over year.',
    origin: 'stated' as const,
    supports: ['C1'],
    loadBearing: 'medium' as const,
    testability: 'fundamental' as const,
    dataNeeded: 'Quarterly revenue versus the same quarter a year earlier.',
    rationale: 'The thesis names continued growth explicitly.',
  },
  {
    id: 'A5',
    statement: 'No broad risk-off move overwhelms the company-specific case.',
    origin: 'implicit' as const,
    supports: ['C1'],
    loadBearing: 'low' as const,
    testability: 'price' as const,
    dataNeeded: 'Drawdown from the trailing high on the underlying.',
    rationale: 'A market-wide drawdown dominates single-name fundamentals over this horizon.',
  },
];

export const NVDA_DECOMPOSITION: Decomposition = {
  ticker: 'NVDA',
  thesis:
    'I am long NVDA because AI infrastructure spending keeps accelerating and NVIDIA is the main beneficiary.',
  horizon: '2 quarters',
  proposedTrade: 'long rNVDA',
  claims,
  assumptions,
  ambiguities: ['"Keeps accelerating" is not quantified — read as growth staying above its current rate.'],
  summary: summarise(claims, assumptions),
  meta: { model: 'gemini-3.5-flash-lite', latencyMs: 3120, decomposedAt: '2026-09-16T14:02:11.000Z' },
};

export const NVDA_BREAKERS: BreakerSet = {
  ticker: 'NVDA',
  breakers: [
    {
      id: 'B1',
      kind: 'threshold',
      assumptionRef: 'A3',
      statement: 'Gross margin falls below 70%.',
      metric: 'grossMargin',
      operator: '<',
      threshold: 70,
      severity: 'medium',
      severityInherited: true,
      cadence: 'periodic',
    },
    {
      id: 'B2',
      kind: 'threshold',
      assumptionRef: 'A4',
      statement: 'Year-over-year revenue growth falls below 30%.',
      metric: 'revenueGrowthYoY',
      operator: '<',
      threshold: 30,
      severity: 'medium',
      severityInherited: true,
      cadence: 'periodic',
    },
    {
      id: 'B3',
      kind: 'threshold',
      assumptionRef: 'A5',
      statement: 'The underlying falls 30% or more from its trailing high.',
      metric: 'drawdownFromHigh',
      operator: '<=',
      threshold: -30,
      severity: 'low',
      severityInherited: true,
      cadence: 'continuous',
    },
  ],
  uncovered: [
    { assumptionId: 'A1', statement: assumptions[0]!.statement, reason: 'No data source can test it.' },
    { assumptionId: 'A2', statement: assumptions[1]!.statement, reason: 'No data source can test it.' },
  ],
  summary: {
    total: 3,
    byCadence: { continuous: 1, event: 0, periodic: 2 },
    quietUntilEarnings: false,
    uncoveredHighLoad: ['A1', 'A2'],
  },
  meta: { model: 'gemini-3.5-flash-lite', latencyMs: 2870, generatedAt: '2026-09-16T14:02:19.000Z' },
};

// ---------------------------------------------------------------------------
// Evaluations — mirroring the recorded run in HANDOFF.md ("BREAKER EVALUATOR")
// ---------------------------------------------------------------------------

const TENQ: Provenance = {
  status: 'inferred',
  source: 'SEC 10-Q 0001045810-26-000075',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm',
  asOf: '2026-08-26',
  confidence: 'high',
  derivation: 'GrossProfit ÷ Revenues, both from the same filing',
};

const YAHOO: Provenance = {
  status: 'sourced',
  source: 'Yahoo Finance chart · NVDA daily',
  asOf: '2026-09-15',
  confidence: 'high',
};

export const NVDA_LIVE: Evaluation[] = [
  {
    breakerId: 'B1',
    mode: 'live',
    status: 'holding',
    metric: 'grossMargin',
    observed: 74.98,
    threshold: 70,
    headroom: 4.98,
    period: '2026-07-26',
    asOf: '2026-08-26',
    provenance: TENQ,
  },
  {
    breakerId: 'B2',
    mode: 'live',
    status: 'holding',
    metric: 'revenueGrowthYoY',
    observed: 55.6,
    threshold: 30,
    headroom: 25.6,
    period: '2026-07-26',
    asOf: '2026-08-26',
    provenance: TENQ,
  },
  {
    breakerId: 'B3',
    mode: 'live',
    status: 'holding',
    metric: 'drawdownFromHigh',
    observed: -10.81,
    threshold: -30,
    headroom: 19.19,
    asOf: '2026-09-15',
    provenance: YAHOO,
  },
];

/**
 * An event breaker with no news provider wired.
 *
 * Kept out of NVDA_BREAKERS so the assumption tree stays internally consistent,
 * but present here because `undeterminable` is a state the UI must render
 * honestly — it is never collapsed into "holding".
 */
export const EVENT_BREAKER: ThesisBreaker = {
  id: 'B4',
  kind: 'event',
  assumptionRef: 'A4',
  statement: 'NVIDIA guides below consensus for the coming quarter.',
  watchFor: 'guidance cut or lowered outlook at the next earnings call',
  keywords: ['guidance', 'outlook', 'forecast', 'cuts'],
  severity: 'high',
  severityInherited: true,
  cadence: 'event',
};

export const EVENT_EVALUATION: Evaluation = {
  breakerId: 'B4',
  mode: 'live',
  status: 'undeterminable',
  reason:
    'Event breakers need a news feed; none is wired. Watch manually for: guidance cut or lowered outlook at the next earnings call.',
};

/** Scenario: gross margin 62%, revenue growth 15%. */
export const NVDA_SCENARIO: Evaluation[] = [
  {
    breakerId: 'B1',
    mode: 'scenario',
    status: 'fired',
    metric: 'grossMargin',
    observed: 62,
    threshold: 70,
    headroom: -8,
  },
  {
    breakerId: 'B2',
    mode: 'scenario',
    status: 'fired',
    metric: 'revenueGrowthYoY',
    observed: 15,
    threshold: 30,
    headroom: -15,
  },
  { breakerId: 'B3', mode: 'scenario', status: 'unaffected' },
];
