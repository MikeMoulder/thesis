import type { Evaluation } from '../engine/breakers/evaluate';
import type { BreakerSet } from '../engine/breakers/types';
import type { Decomposition } from '../engine/decomposer/types';
import {
  deriveAssumptionHealth,
  deriveThesisHealth,
  diffChecks,
  type MetricScales,
} from './health';
import {
  currentVersion,
  latestCheck,
  type Check,
  type ThesisRecord,
  type ThesisVersion,
} from './types';

/**
 * Building and extending a thesis record.
 *
 * Kept out of the route handlers on purpose. `appendCheck` is the single place
 * a check is ever added — by the create route, by the cron, and by the
 * historical backfill — so all three produce identically-shaped history. If the
 * cron wrote checks in a slightly different shape from the backfill, the
 * autopsy would be comparing two different things and nobody would notice until
 * the numbers looked odd on stage.
 */

/** Readable in a URL and unique enough: `nvda-k3f9c2`. */
export function thesisId(ticker: string): string {
  const slug = ticker.toLowerCase().replace(/[^a-z0-9]/g, '') || 'thesis';
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Which way the user is leaning.
 *
 * Taken from the claims rather than guessed from the prose. A thesis with no
 * stated direction is `neutral` — inferring one would put a word in the user's
 * mouth on the screen that is meant to hold them to their own words.
 */
export function deriveDirection(decomposition: Decomposition): ThesisRecord['direction'] {
  const directions = decomposition.claims
    .map((c) => c.direction)
    .filter((d): d is 'bullish' | 'bearish' | 'neutral' => Boolean(d));

  const bullish = directions.filter((d) => d === 'bullish').length;
  const bearish = directions.filter((d) => d === 'bearish').length;
  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

export interface AppendCheckInput {
  evaluations: Evaluation[];
  /** Zero for a recheck — the evaluator reads data, it does not call a model. */
  modelCalls: number;
  source: Check['source'];
  /** Injectable so the backfill can write checks at their real historical time. */
  at?: string;
  scales?: MetricScales;
}

/**
 * Add one check to a thesis, returning a new record.
 *
 * Does NOT change `status`. A thesis whose load-bearing assumption just failed
 * is `health: 'broken'` but still `status: 'live'`, because only the person who
 * holds the belief gets to retire it. That gap between "the evidence says this
 * failed" and "I accept that it failed" is the entire accountability loop —
 * closing it automatically would turn the product back into something that
 * tells you what to think.
 */
export function appendCheck(thesis: ThesisRecord, input: AppendCheckInput): ThesisRecord {
  const version = currentVersion(thesis);
  const previous = latestCheck(thesis);

  const assumptions = deriveAssumptionHealth({
    assumptions: version.decomposition.assumptions,
    breakers: version.breakerSet.breakers,
    evaluations: input.evaluations,
    previous,
    ...(input.scales ? { scales: input.scales } : {}),
  });

  const check: Check = {
    at: input.at ?? new Date().toISOString(),
    version: version.n,
    evaluations: input.evaluations,
    assumptions,
    health: deriveThesisHealth(assumptions),
    // A version bump resets the baseline: the previous check was measuring a
    // different set of assumptions, so a "change" across that boundary would be
    // an artefact of the user editing their thesis, not of the world moving.
    changes: previous && previous.version === version.n ? diffChecks(previous.assumptions, assumptions) : [],
    modelCalls: input.modelCalls,
    source: input.source,
  };

  return { ...thesis, checks: [...thesis.checks, check] };
}

export interface CreateThesisInput {
  ticker: string;
  /** The user's own words. Stored verbatim as version 1. */
  statement: string;
  decomposition: Decomposition;
  breakerSet: BreakerSet;
  evaluations: Evaluation[];
  modelCalls: number;
  id?: string;
  at?: string;
  scales?: MetricScales;
}

/** A brand-new thesis: version 1, plus the check that established its baseline. */
export function createThesis(input: CreateThesisInput): ThesisRecord {
  const at = input.at ?? new Date().toISOString();

  const version: ThesisVersion = {
    n: 1,
    statement: input.statement,
    createdAt: at,
    decomposition: input.decomposition,
    breakerSet: input.breakerSet,
  };

  const base: ThesisRecord = {
    id: input.id ?? thesisId(input.ticker),
    ticker: input.ticker.toUpperCase(),
    direction: deriveDirection(input.decomposition),
    createdAt: at,
    status: 'live',
    versions: [version],
    checks: [],
  };

  return appendCheck(base, {
    evaluations: input.evaluations,
    modelCalls: input.modelCalls,
    source: 'initial',
    at,
    ...(input.scales ? { scales: input.scales } : {}),
  });
}

export interface ReviseThesisInput {
  statement: string;
  reason: string;
  decomposition: Decomposition;
  breakerSet: BreakerSet;
  evaluations: Evaluation[];
  modelCalls: number;
  /** The evidence that prompted the revision, so the autopsy can show cause. */
  promptedBy?: ThesisVersion['promptedBy'];
  at?: string;
  scales?: MetricScales;
}

/**
 * A revision: a NEW version, never an edit of the old one.
 *
 * The old version stays exactly as written. That is what lets the autopsy show
 * what was believed WHEN the evidence arrived, rather than what the user
 * quietly retreated to afterwards — which is the difference between a record
 * and a flattering story.
 */
export function reviseThesis(thesis: ThesisRecord, input: ReviseThesisInput): ThesisRecord {
  const at = input.at ?? new Date().toISOString();

  const version: ThesisVersion = {
    n: currentVersion(thesis).n + 1,
    statement: input.statement,
    createdAt: at,
    reason: input.reason,
    ...(input.promptedBy ? { promptedBy: input.promptedBy } : {}),
    decomposition: input.decomposition,
    breakerSet: input.breakerSet,
  };

  const revised: ThesisRecord = {
    ...thesis,
    direction: deriveDirection(input.decomposition),
    // Revising is how a broken thesis comes back under observation.
    status: 'live',
    versions: [...thesis.versions, version],
  };

  return appendCheck(revised, {
    evaluations: input.evaluations,
    modelCalls: input.modelCalls,
    source: 'initial',
    at,
    ...(input.scales ? { scales: input.scales } : {}),
  });
}
