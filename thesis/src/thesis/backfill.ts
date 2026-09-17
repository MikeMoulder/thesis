import type { DataSource } from '../data/DataSource';
import type { Candle, Instrument, Provenance } from '../data/types';
import { compare, readFundamentalSeries, type Evaluation } from '../engine/breakers/evaluate';
import {
  computePriceMetric,
  getPriceSeries,
  isFundamental,
  WINDOW_DAYS,
} from '../engine/breakers/metrics';
import type { Metric, PriceMetric, ThesisBreaker } from '../engine/breakers/types';
import { getRateLimiter } from '../llm/index';
import type { MetricScales } from './health';
import { appendCheck } from './record';
import { currentVersion, type Check, type HealthChange, type ThesisRecord } from './types';

/**
 * The historical backfill — the thesis's past, reconstructed.
 *
 * A thesis created today has a log one entry long, and a log one entry long
 * cannot show the only thing that makes this product different: that a belief
 * was holding, then weakened, then broke, and that the first warning arrived
 * before the break did. Waiting for the market to supply that live is not a
 * plan — it is a hope, and a market is free to decline.
 *
 * So this walks the SAME breakers backwards through the SAME data the live loop
 * reads, and asks at each past day: what would the check have said? The answer
 * is written as an ordinary `Check` with `source: 'backfill'`, so a reader can
 * always tell a reconstruction from an observation.
 *
 * ## The one rule this file exists to obey
 *
 * **No look-ahead.** A backfilled check for 12 June may use only what was
 * knowable on 12 June. A fundamental figure is dated by when it was FILED, not
 * by the quarter it describes, and a price metric is computed from bars at or
 * before that day. Break this and the output is not history — it is a
 * reconstruction with tomorrow's newspaper in it, which would turn every "we
 * warned you first" claim on the screen into a lie. It is asserted in
 * `backfill:selftest` rather than merely intended.
 *
 * Like a recheck, this costs ZERO model calls. The tripwires were written once.
 */

/** Calendar days of history reconstructed when the caller does not say. */
export const DEFAULT_BACKFILL_DAYS = 90;

export interface BackfillOptions {
  /** Calendar days of history to reconstruct. Default 90. */
  days?: number;
  /** Emit one check every N bars. 1 is daily, the natural data granularity. */
  stride?: number;
  /**
   * Discard existing backfilled checks and rebuild them.
   *
   * Legal where re-running the live loop would not be: a backfilled check is a
   * DERIVATION, and re-deriving it from the same inputs is not rewriting
   * history. Observed checks — 'live' and 'initial' — are never touched by
   * this, with or without the flag.
   */
  replace?: boolean;
  scales?: MetricScales;
}

export interface BackfillReport {
  id: string;
  ticker: string;
  /** Checks written by this run. */
  written: number;
  from: string | null;
  to: string | null;
  /** Health transitions inside the reconstructed span. The point of the exercise. */
  transitions: Array<HealthChange & { at: string }>;
  /** Measured against the rate limiter, not assumed. Must be 0. */
  modelCalls: number;
  /** Anything a reader needs in order to judge the output. Never silently dropped. */
  notes: string[];
}

function totalModelCalls(): number {
  return getRateLimiter()
    .allUsage()
    .reduce((sum, row) => sum + row.used, 0);
}

/** A metric's value as at a past moment, with where it came from. */
interface PastReading {
  value: number;
  asOf: string;
  provenance: Provenance;
  period?: string;
}

/** Filed figures for one metric, oldest first, dated by when they became knowable. */
interface MetricHistory {
  points?: Array<{ date: string; value: number; period: string }>;
  source?: string;
}

export interface BackfillInputs {
  /** One long daily series, shared by every price metric. */
  candles: Candle[];
  seriesFrom: 'rToken' | 'underlying';
  seriesProvenance: Provenance;
  byMetric: Map<Metric, MetricHistory>;
  notes: string[];
}

/**
 * Fetch the history every breaker in the set needs, once.
 *
 * Fetching per day instead would issue a request per breaker per bar — some
 * thousands of calls to SEC and Yahoo to reconstruct one quarter, which is both
 * slow and rude enough to get the User-Agent blocked.
 *
 * The price window is sized to the LONGEST trailing window any breaker needs
 * PLUS the whole backfill span, so the earliest reconstructed day still has a
 * full window behind it. Get this wrong and the oldest checks quietly read
 * `undeterminable` for a metric that is perfectly computable.
 */
export async function loadBackfillInputs(
  ds: DataSource,
  instrument: Instrument,
  breakers: ThesisBreaker[],
  days: number,
): Promise<BackfillInputs> {
  const notes: string[] = [];
  const byMetric = new Map<Metric, MetricHistory>();

  const thresholds = breakers.filter(
    (b): b is Extract<ThesisBreaker, { kind: 'threshold' }> => b.kind === 'threshold',
  );

  const trailing = thresholds
    .map((b) => b.metric)
    .filter((m): m is PriceMetric => !isFundamental(m))
    .reduce((max, m) => Math.max(max, WINDOW_DAYS[m]), 1);

  const series = await getPriceSeries(ds, instrument, days + trailing);

  if (series.from === 'underlying') {
    notes.push(
      'Price metrics were reconstructed from the underlying equity, because the rToken ' +
        'has only ~90 days of history and the window needed is longer. The live loop ' +
        'prefers the rToken where it can, so a reconstructed value and a live one for the ' +
        'same metric may differ slightly. Both say which they used in provenance.',
    );
  }

  for (const breaker of thresholds) {
    if (!isFundamental(breaker.metric)) continue;
    if (byMetric.has(breaker.metric)) continue;
    try {
      const points = await readFundamentalSeries(ds, instrument, breaker);
      byMetric.set(breaker.metric, {
        points: [...points].sort((a, b) => a.date.localeCompare(b.date)),
        source: `SEC EDGAR — ${breaker.metric}, dated by first filing`,
      });
    } catch (error) {
      notes.push(
        `${breaker.metric}: no filing history could be read (${
          error instanceof Error ? error.message : String(error)
        }). Breakers on it read "undeterminable" throughout, which is the honest answer.`,
      );
      byMetric.set(breaker.metric, {});
    }
  }

  return {
    candles: series.candles,
    seriesFrom: series.from,
    seriesProvenance: series.provenance,
    byMetric,
    notes,
  };
}

/**
 * The value of a fundamental metric as it was knowable at `atIso` — and never a
 * moment sooner.
 *
 * The comparison is against the KNOWABLE date, so Q2 numbers filed on 23 July
 * are invisible to a check dated 22 July. That is the entire no-look-ahead rule
 * in one function, which is why the caller must never hand it a period end.
 */
export function fundamentalAsAt(
  history: MetricHistory,
  atIso: string,
): { date: string; value: number; period: string } | null {
  const points = history.points;
  if (!points || points.length === 0) return null;
  const day = atIso.slice(0, 10);

  let found: { date: string; value: number; period: string } | null = null;
  for (const point of points) {
    if (point.date > day) break; // sorted, so everything after this was filed later
    found = point;
  }
  return found;
}

/** Index of the latest bar at or before `ts`. Never a bar after it. */
export function indexAsAt(candles: Array<{ ts: number }>, ts: number): number {
  let index = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i]!.ts > ts) break;
    index = i;
  }
  return index;
}

function readPast(metric: Metric, atIso: string, inputs: BackfillInputs): PastReading | null {
  if (isFundamental(metric)) {
    const history = inputs.byMetric.get(metric);
    if (!history) return null;
    const point = fundamentalAsAt(history, atIso);
    if (!point) return null;
    return {
      value: point.value,
      asOf: point.date,
      period: point.period,
      provenance: {
        status: 'inferred',
        source: history.source ?? 'SEC EDGAR',
        asOf: point.date,
        confidence: 'high',
        derivation:
          `${metric} for period ${point.period}, first filed ${point.date} — the latest ` +
          `figure knowable as of ${atIso.slice(0, 10)}. Nothing filed after that date was used.`,
      },
    };
  }

  const index = indexAsAt(inputs.candles, Date.parse(atIso));
  if (index < 0) return null;

  const value = computePriceMetric(inputs.candles, metric as PriceMetric, index);
  if (value === null) return null;

  const asOf = new Date(inputs.candles[index]!.ts).toISOString();
  return {
    value,
    asOf,
    provenance: {
      ...inputs.seriesProvenance,
      status: 'inferred',
      asOf,
      derivation:
        `${metric} reconstructed from ${inputs.seriesFrom} daily closes up to and including ` +
        `${atIso.slice(0, 10)}. No bar after that date was used.`,
    },
  };
}

/**
 * One breaker, evaluated as at a past moment.
 *
 * Mirrors `evaluateLive` in shape and in failure behaviour: a metric that
 * cannot be read becomes `undeterminable` with a reason, never a silent
 * "holding". A reconstruction that invented comfort it never measured would be
 * worse than no reconstruction at all.
 */
export function evaluateAsAt(
  breaker: ThesisBreaker,
  atIso: string,
  inputs: BackfillInputs,
): Evaluation {
  if (breaker.kind === 'event') {
    return {
      breakerId: breaker.id,
      mode: 'historical',
      status: 'undeterminable',
      reason: `event breakers need a searchable news archive; none is wired. Watch for: ${breaker.watchFor}`,
    };
  }

  const reading = readPast(breaker.metric, atIso, inputs);
  if (!reading) {
    return {
      breakerId: breaker.id,
      mode: 'historical',
      status: 'undeterminable',
      metric: breaker.metric,
      reason: isFundamental(breaker.metric)
        ? `no ${breaker.metric} had been filed as of ${atIso.slice(0, 10)}`
        : `not enough price history before ${atIso.slice(0, 10)} to compute ${breaker.metric}`,
    };
  }

  const fired = compare(reading.value, breaker.operator, breaker.threshold);
  return {
    breakerId: breaker.id,
    mode: 'historical',
    status: fired ? 'fired' : 'holding',
    metric: breaker.metric,
    observed: reading.value,
    threshold: breaker.threshold,
    headroom:
      breaker.operator === '<' || breaker.operator === '<='
        ? reading.value - breaker.threshold
        : breaker.threshold - reading.value,
    asOf: reading.asOf,
    ...(reading.period ? { period: reading.period } : {}),
    provenance: reading.provenance,
  };
}

// ---------------------------------------------------------------------------

/**
 * Reconstruct a thesis's past and splice it in front of what it has observed.
 *
 * The existing checks are carried across UNTOUCHED and still last, so the log
 * reads oldest-first as it always has. The live ones keep the health and the
 * `changes` they were computed with at the time — recomputing them against a
 * past that did not exist when they ran would be editing an observation to
 * agree with a later reconstruction, which is exactly backwards.
 */
export async function backfillThesis(
  ds: DataSource,
  instrument: Instrument,
  thesis: ThesisRecord,
  options: BackfillOptions = {},
): Promise<{ thesis: ThesisRecord; report: BackfillReport }> {
  const callsBefore = totalModelCalls();
  const days = options.days ?? DEFAULT_BACKFILL_DAYS;
  const stride = Math.max(1, options.stride ?? 1);

  // A multi-version thesis would need each version replayed over the window it
  // was actually in force, or every reconstructed check would be stamped with a
  // version number that had not been written yet. Refusing is honest; guessing
  // would put words in the user's mouth and date them to before they said them.
  if (thesis.versions.length !== 1) {
    throw new Error(
      `${thesis.id} has ${thesis.versions.length} versions. Backfill replays one set of ` +
        `breakers and would stamp every reconstructed check with the current version, ` +
        `which was not in force at the time. Not supported.`,
    );
  }

  const observed = thesis.checks.filter((c) => c.source !== 'backfill');
  const existing = thesis.checks.filter((c) => c.source === 'backfill');
  if (existing.length > 0 && !options.replace) {
    throw new Error(
      `${thesis.id} already has ${existing.length} backfilled checks. Pass replace to ` +
        `rebuild them; observed checks are never touched either way.`,
    );
  }

  // Stop before the first thing actually observed. Two entries for the same
  // moment — one reconstructed, one real — would make "how many times has this
  // been checked?" unanswerable.
  const until = observed[0]?.at ?? thesis.createdAt;
  const untilTs = Date.parse(until);
  const fromTs = untilTs - days * 86_400_000;

  const version = currentVersion(thesis);
  const breakers = version.breakerSet.breakers;
  const inputs = await loadBackfillInputs(ds, instrument, breakers, days);

  const bars = inputs.candles
    .map((candle, index) => ({ index, ts: candle.ts }))
    .filter((bar) => bar.ts >= fromTs && bar.ts < untilTs)
    .filter((_, n) => n % stride === 0);

  let working: ThesisRecord = { ...thesis, checks: [] };
  for (const bar of bars) {
    const at = new Date(bar.ts).toISOString();
    working = appendCheck(working, {
      evaluations: breakers.map((breaker) => evaluateAsAt(breaker, at, inputs)),
      modelCalls: 0,
      source: 'backfill',
      at,
      ...(options.scales ? { scales: options.scales } : {}),
    });
  }

  const reconstructed = working.checks;
  const transitions = reconstructed.flatMap((check) =>
    check.changes.map((change) => ({ ...change, at: check.at })),
  );

  const notes = [...inputs.notes];
  if (reconstructed.length === 0) {
    notes.push(
      `No bars fell between ${new Date(fromTs).toISOString().slice(0, 10)} and ` +
        `${until.slice(0, 10)}, so nothing was written.`,
    );
  } else if (transitions.length === 0) {
    notes.push(
      'The reconstructed span contains no health transition. The log is real and it is ' +
        'longer, but it does not show a belief changing state — do not present it as ' +
        'though it does.',
    );
  }

  return {
    thesis: { ...thesis, checks: [...reconstructed, ...observed] },
    report: {
      id: thesis.id,
      ticker: thesis.ticker,
      written: reconstructed.length,
      from: reconstructed[0]?.at ?? null,
      to: reconstructed[reconstructed.length - 1]?.at ?? null,
      transitions,
      modelCalls: totalModelCalls() - callsBefore,
      notes,
    },
  };
}

/** How many checks in the log were reconstructed rather than observed. */
export function backfilledCount(thesis: ThesisRecord): number {
  return thesis.checks.filter((check: Check) => check.source === 'backfill').length;
}
