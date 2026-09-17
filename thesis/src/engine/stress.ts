import type { DataSource } from '../data/DataSource';
import type { Instrument } from '../data/types';
import { evaluateScenario, type Evaluation, type Scenario } from './breakers/evaluate';
import { readMetric } from './breakers/metrics';
import type { BreakerSet, Metric } from './breakers/types';

/**
 * Preset stress tests.
 *
 * ## Why presets rather than only free-typed what-ifs
 *
 * The desk already answers "what if gross margin falls to 62%?", and that is
 * the better tool once you know what you are worried about. The problem is
 * that you have to know. A trader who has just written a thesis is the person
 * least able to name the shock that would break it, because if they could name
 * it they would have priced it in already.
 *
 * So these are the shocks worth running whether or not anyone asked, and each
 * one exists because it has broken real positions.
 *
 * ## Anchored to the instrument, not to round numbers
 *
 * A preset that asserts "gross margin = 60" is arbitrary: 60 is a catastrophe
 * for one company and an improvement for another. Every preset here is built
 * as a MOVE FROM WHERE THE METRIC ACTUALLY IS, read live before the scenario
 * is constructed. "Ten points off the current margin" means the same thing for
 * every instrument, and a round number does not.
 *
 * A preset whose inputs cannot be read is skipped rather than guessed. Its
 * absence is reported, because "we could not stress your margin because we
 * cannot read your margin" is information and a silently missing row is not.
 */

export interface StressPreset {
  id: string;
  /** Short name for the button. */
  label: string;
  /** What is being asked, in the user's language. */
  question: string;
  /** Why this shock is worth running at all. */
  rationale: string;
  /** Metrics that must be readable for this preset to mean anything. */
  needs: Metric[];
  /** Build the hypothetical from the live readings. Null when not applicable. */
  build(current: Partial<Record<Metric, number>>): Scenario | null;
}

/** Round to one decimal so the label reads like a number a person would say. */
function tidy(value: number): number {
  return Math.round(value * 10) / 10;
}

export const STRESS_PRESETS: StressPreset[] = [
  {
    id: 'margin-shock',
    label: 'Margin shock',
    question: 'What if gross margin falls ten points from here?',
    rationale:
      'Ten points is roughly what competition or a pricing war takes out of a margin over a few quarters. It is the shock most growth theses quietly assume cannot happen.',
    needs: ['grossMargin'],
    build: (current) => {
      const now = current.grossMargin;
      if (now === undefined) return null;
      return { grossMargin: tidy(now - 10) };
    },
  },
  {
    id: 'growth-stall',
    label: 'Growth stalls',
    question: 'What if revenue growth goes to zero?',
    rationale:
      'Not a collapse, just the end of growth. Most theses that depend on compounding break here rather than at a negative number, and a flat line is a far more common outcome than a decline.',
    needs: ['revenueGrowthYoY'],
    build: (current) => (current.revenueGrowthYoY === undefined ? null : { revenueGrowthYoY: 0 }),
  },
  {
    id: 'multiple-compression',
    label: 'Multiple compresses',
    question: 'What if the market pays 30% less for the same earnings?',
    rationale:
      'The business does nothing wrong and the shares still fall, because the rating changed rather than the results. This is the shock a thesis built purely on fundamentals cannot see coming.',
    needs: ['trailingPE'],
    build: (current) => {
      const now = current.trailingPE;
      if (now === undefined || now <= 0) return null;
      return { trailingPE: tidy(now * 0.7) };
    },
  },
  {
    id: 'drawdown',
    label: 'Deep drawdown',
    question: 'What if it falls 30% below its high?',
    rationale:
      'Tests the stop and the conviction together. A drawdown this size is ordinary for a single stock over a year and is where most people abandon a thesis that was going to be right.',
    needs: ['drawdownFromHigh'],
    build: () => ({ drawdownFromHigh: -30 }),
  },
  {
    id: 'vol-spike',
    label: 'Volatility spike',
    question: 'What if volatility doubles?',
    rationale:
      'Position sizing is usually set against calm conditions. When realised volatility doubles, the same number of shares is a materially larger bet than the one that was intended.',
    needs: ['volatility90d'],
    build: (current) => {
      const now = current.volatility90d;
      if (now === undefined || now <= 0) return null;
      return { volatility90d: tidy(now * 2) };
    },
  },
  {
    /*
      The one no other research tool runs.

      Every preset above shocks the COMPANY. This one shocks the EXIT, and it is
      specific to what these instruments are: tokenized equities whose books are
      thinner than the underlying and can be empty outright. rNFLX was quoting a
      live price against 12.4M of 24 hour volume with zero resting bids on
      17 Sep 2026.

      Zero rather than a reduction, because that is the observed failure. The
      book does not thin out politely; it goes away.
    */
    id: 'liquidity-drain',
    label: 'The bid disappears',
    question: 'What if there is nothing on the bid when you try to leave?',
    rationale:
      'A stop only works if somebody is buying at that level. Half the rTokens listed on Bitget show a live price and real 24 hour volume above an empty book, and no price feed or chart would tell you.',
    needs: ['exitDepthUsd'],
    build: () => ({ exitDepthUsd: 0 }),
  },
];

export interface StressResult {
  preset: StressPreset;
  /** The hypothetical actually applied, so the number on screen is checkable. */
  scenario: Scenario;
  evaluations: Evaluation[];
  /** Breakers this shock tripped. The headline of the row. */
  firedCount: number;
}

export interface StressReport {
  results: StressResult[];
  /** Presets that could not run, with the reason. Never silently dropped. */
  skipped: Array<{ preset: StressPreset; reason: string }>;
  /** Current readings the scenarios were built from, for the "from X to Y" line. */
  current: Partial<Record<Metric, number>>;
}

/**
 * Read every metric the presets need, once.
 *
 * Deduplicated because several presets share inputs and each read is a network
 * call. A failed read is recorded as absent rather than thrown: one unreadable
 * metric should cost one preset, not the whole panel.
 */
async function readCurrent(
  ds: DataSource,
  instrument: Instrument,
  metrics: Metric[],
): Promise<Partial<Record<Metric, number>>> {
  const unique = [...new Set(metrics)];
  const readings = await Promise.all(
    unique.map(async (metric) => {
      try {
        const reading = await readMetric(ds, instrument, metric);
        return [metric, reading.value] as const;
      } catch {
        return [metric, undefined] as const;
      }
    }),
  );

  const current: Partial<Record<Metric, number>> = {};
  for (const [metric, value] of readings) if (value !== undefined) current[metric] = value;
  return current;
}

/**
 * Run every preset against a thesis's breakers.
 *
 * No model calls at all. These are the same structured breakers the live
 * monitor evaluates, pointed at a hypothetical instead of at today's data,
 * which is the whole reason breakers are stored as conditions rather than as
 * prose. It is also why running six stress tests costs nothing.
 */
export async function runStressPresets(
  ds: DataSource,
  instrument: Instrument,
  breakerSet: BreakerSet,
  presets: StressPreset[] = STRESS_PRESETS,
): Promise<StressReport> {
  const current = await readCurrent(ds, instrument, presets.flatMap((p) => p.needs));

  const results: StressResult[] = [];
  const skipped: StressReport['skipped'] = [];

  for (const preset of presets) {
    const missing = preset.needs.filter((metric) => current[metric] === undefined);
    const scenario = preset.build(current);

    /*
      A preset is only skipped when it needs a reading it does not have AND
      could not build a scenario without one. Some presets are absolute -- a 30%
      drawdown is 30% whatever the price is now -- so a missing current reading
      does not stop them.
    */
    if (!scenario) {
      skipped.push({
        preset,
        reason:
          missing.length > 0
            ? `could not read ${missing.join(', ')} for ${instrument.ticker}`
            : 'not applicable to this thesis',
      });
      continue;
    }

    const evaluations = breakerSet.breakers.map((breaker) => evaluateScenario(breaker, scenario));
    // Only breakers this shock actually touches count. A breaker on a metric
    // the scenario never set comes back 'unaffected', which is not a pass.
    const firedCount = evaluations.filter((e) => e.status === 'fired').length;
    results.push({ preset, scenario, evaluations, firedCount });
  }

  return { results, skipped, current };
}

/**
 * One line summarising what a stress test did, for the row header.
 *
 * Says where the number came FROM as well as where it went, because "gross
 * margin to 65%" is only alarming if you know it is 75% today.
 */
export function describeStress(result: StressResult, current: Partial<Record<Metric, number>>): string {
  const parts: string[] = [];
  for (const [metric, value] of Object.entries(result.scenario) as Array<[Metric, number]>) {
    const now = current[metric];
    parts.push(now === undefined ? `${metric} ${value}` : `${metric} ${tidy(now)} to ${value}`);
  }
  return parts.join(', ');
}

/** How many of the thesis's breakers any preset managed to trip. */
export function worstCase(report: StressReport): StressResult | null {
  return report.results.reduce<StressResult | null>(
    (worst, r) => (worst === null || r.firedCount > worst.firedCount ? r : worst),
    null,
  );
}
