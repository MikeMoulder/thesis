import { MalformedOutputError } from '../../llm/types';
import type { Assumption } from '../decomposer/types';
import { TESTABILITY_CADENCE } from '../decomposer/types';
import {
  FUNDAMENTAL_METRICS,
  LIQUIDITY_METRICS,
  PRICE_METRICS,
  VALUATION_METRICS,
  type Cadence,
  type Metric,
  type Operator,
  type Severity,
  type ThesisBreaker,
} from './types';

const OPERATORS: readonly Operator[] = ['<', '<=', '>', '>='];
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];
const ALL_METRICS = new Set<string>([
  ...FUNDAMENTAL_METRICS,
  ...PRICE_METRICS,
  ...VALUATION_METRICS,
  ...LIQUIDITY_METRICS,
]);

/** Cadence follows from the metric — filings do not update continuously. */
function cadenceForMetric(metric: Metric): Cadence {
  // Valuation is continuous like price: the multiple moves every time the share
  // price does, even though the earnings underneath it change quarterly.
  return (FUNDAMENTAL_METRICS as readonly string[]).includes(metric) ? 'periodic' : 'continuous';
}

export interface ValidatedBreakers {
  breakers: ThesisBreaker[];
  uncovered: Array<{ assumptionId: string; statement: string; reason: string }>;
  /**
   * Testable assumptions that got no breaker. The prompt asks for full
   * coverage and the model still under-produces — observed writing one breaker
   * for four testable assumptions, leaving two high-load ones with no tripwire.
   *
   * Recoverable, so it drives a repair round rather than failing the run.
   */
  softProblems: string[];
}

export function validateBreakers(
  parsed: unknown,
  raw: string,
  assumptions: Assumption[],
): ValidatedBreakers {
  const problems: string[] = [];
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') {
    throw new MalformedOutputError('Top-level value is not an object', raw);
  }

  const byId = new Map(assumptions.map((a) => [a.id, a]));
  const rawBreakers = root.breakers;
  if (!Array.isArray(rawBreakers)) {
    throw new MalformedOutputError('"breakers" must be an array', raw);
  }

  const breakers: ThesisBreaker[] = [];

  rawBreakers.forEach((b, i) => {
    const rec = b as Record<string, unknown>;
    if (!rec || typeof rec !== 'object') {
      return problems.push(`breakers[${i}] is not an object`);
    }

    const id = str(rec.id) ?? `B${i + 1}`;
    const assumptionRef = str(rec.assumptionRef);
    const statement = str(rec.statement);

    if (!statement) return problems.push(`breakers[${i}].statement is missing`);
    if (!assumptionRef || !byId.has(assumptionRef)) {
      return problems.push(
        `breakers[${i}].assumptionRef was ${JSON.stringify(assumptionRef)}, which is not one of the assumption ids provided`,
      );
    }

    const assumption = byId.get(assumptionRef)!;

    // An untestable assumption cannot have an honest breaker. If one appears,
    // the model has invented an observation we cannot make.
    if (assumption.testability === 'none') {
      return problems.push(
        `breakers[${i}] targets ${assumptionRef}, whose testability is "none" — no data can check it, so it must not have a breaker`,
      );
    }

    // Severity is inherited from the decomposer, never taken from this model.
    // The decomposer saw the whole thesis at once and ranked assumptions
    // against each other; a generator looking at one assumption in isolation
    // cannot reproduce that ordering, so its opinion is discarded.
    //
    // severityInherited stays true until historical mode replaces these with
    // measured base rates. Until then the UI must not present severity as if
    // it were evidence.
    const base = {
      id,
      assumptionRef,
      statement,
      severity: assumption.loadBearing satisfies Severity,
      severityInherited: true,
    };

    const kind = str(rec.kind);

    if (kind === 'event') {
      const watchFor = str(rec.watchFor);
      if (!watchFor) return problems.push(`breakers[${i}].watchFor is missing for an event breaker`);
      const keywords = Array.isArray(rec.keywords)
        ? rec.keywords.map(String).filter((k) => k.trim().length > 0)
        : [];
      if (keywords.length === 0) {
        return problems.push(`breakers[${i}].keywords must be a non-empty array for an event breaker`);
      }
      breakers.push({ ...base, kind: 'event', cadence: 'event', watchFor, keywords });
      return;
    }

    if (kind === 'threshold') {
      const metric = str(rec.metric);
      if (!metric || !ALL_METRICS.has(metric)) {
        return problems.push(
          `breakers[${i}].metric was ${JSON.stringify(metric)}, expected one of: ${[...ALL_METRICS].join(', ')}`,
        );
      }
      const operator = str(rec.operator);
      if (!operator || !(OPERATORS as readonly string[]).includes(operator)) {
        return problems.push(
          `breakers[${i}].operator was ${JSON.stringify(operator)}, expected one of ${OPERATORS.join(' ')}`,
        );
      }
      const threshold = typeof rec.threshold === 'number' ? rec.threshold : Number(rec.threshold);
      if (!Number.isFinite(threshold)) {
        return problems.push(
          `breakers[${i}].threshold was ${JSON.stringify(rec.threshold)}, expected a number`,
        );
      }

      // Derived from the metric rather than trusted from the model: a
      // fundamental metric marked "continuous" would make the live monitor
      // promise updates that filings cannot deliver.
      breakers.push({
        ...base,
        kind: 'threshold',
        metric: metric as Metric,
        operator: operator as Operator,
        threshold,
        cadence: cadenceForMetric(metric as Metric),
      });
      return;
    }

    problems.push(`breakers[${i}].kind was ${JSON.stringify(kind)}, expected "threshold" or "event"`);
  });

  if (problems.length > 0) {
    throw new MalformedOutputError(
      `Breaker generation failed validation:\n- ${problems.join('\n- ')}`,
      raw,
    );
  }

  // Assumptions with no breaker. Untestable ones are expected; a testable one
  // with no breaker is a gap worth showing.
  const covered = new Set(breakers.map((b) => b.assumptionRef));
  const uncovered = assumptions
    .filter((a) => !covered.has(a.id))
    .map((a) => ({
      assumptionId: a.id,
      statement: a.statement,
      reason:
        a.testability === 'none'
          ? 'no available data can test this assumption'
          : `expected a ${TESTABILITY_CADENCE[a.testability]} breaker but none was produced`,
    }));

  const softProblems: string[] = [];
  for (const a of assumptions) {
    if (a.testability === 'none' || covered.has(a.id)) continue;
    softProblems.push(
      `${a.id} ("${a.statement}") is testable via ${a.testability} data and carries ${a.loadBearing} load, but you wrote no breaker for it. ` +
        (a.testability === 'event'
          ? 'Write an event breaker: name the announcement that would settle it, and the words that would appear in the headline.'
          : `Write a ${a.testability} threshold breaker for it.`),
    );
  }

  return { breakers, uncovered, softProblems };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
