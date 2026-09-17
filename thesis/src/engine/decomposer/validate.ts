import { MalformedOutputError } from '../../llm/types';
import type { Assumption, Claim, Testability } from './types';
import { checkDataNeeded } from './capabilities';

/**
 * Validate and normalise the decomposer's JSON.
 *
 * Hand-rolled rather than schema-library driven so the error messages can name
 * exactly what the model got wrong — those messages are fed back in the repair
 * pass, and "assumptions[2].testability was 'earnings', expected one of ..." is
 * far more repairable than a generic type error.
 */

const TESTABILITY: readonly Testability[] = ['fundamental', 'price', 'event', 'none'];
const LOAD_BEARING = ['high', 'medium', 'low'] as const;
const ORIGIN = ['stated', 'implicit'] as const;
const DIRECTION = ['bullish', 'bearish', 'neutral'] as const;

export interface ValidatedDecomposition {
  claims: Claim[];
  assumptions: Assumption[];
  ambiguities: string[];
  /**
   * Recoverable complaints: the structure is sound but an assumption claims to
   * be testable using data we do not have. Worth a repair attempt, but not
   * worth discarding an otherwise good decomposition over — see
   * downgradeUntestable().
   */
  softProblems: SoftProblem[];
}

export interface SoftProblem {
  assumptionId: string;
  message: string;
}

export function validateDecomposition(parsed: unknown, raw: string): ValidatedDecomposition {
  const problems: string[] = [];
  const root = asRecord(parsed);
  if (!root) throw new MalformedOutputError('Top-level value is not an object', raw);

  // -- claims ---------------------------------------------------------------
  const claims: Claim[] = [];
  const rawClaims = root.claims;
  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    problems.push('"claims" must be a non-empty array');
  } else {
    rawClaims.forEach((c, i) => {
      const rec = asRecord(c);
      if (!rec) return problems.push(`claims[${i}] is not an object`);
      const id = str(rec.id) ?? `C${i + 1}`;
      const statement = str(rec.statement);
      if (!statement) return problems.push(`claims[${i}].statement is missing`);

      const direction = str(rec.direction);
      claims.push({
        id,
        statement,
        ...(direction && (DIRECTION as readonly string[]).includes(direction)
          ? { direction: direction as Claim['direction'] }
          : {}),
      });
    });
  }

  const claimIds = new Set(claims.map((c) => c.id));

  // -- assumptions ----------------------------------------------------------
  const assumptions: Assumption[] = [];
  const rawAssumptions = root.assumptions;
  if (!Array.isArray(rawAssumptions) || rawAssumptions.length === 0) {
    problems.push('"assumptions" must be a non-empty array');
  } else {
    rawAssumptions.forEach((a, i) => {
      const rec = asRecord(a);
      if (!rec) return problems.push(`assumptions[${i}] is not an object`);

      const id = str(rec.id) ?? `A${i + 1}`;
      const statement = str(rec.statement);
      if (!statement) return problems.push(`assumptions[${i}].statement is missing`);

      const testability = str(rec.testability);
      if (!testability || !TESTABILITY.includes(testability as Testability)) {
        return problems.push(
          `assumptions[${i}].testability was ${JSON.stringify(testability)}, expected one of ${TESTABILITY.join(' | ')}`,
        );
      }

      const loadBearing = str(rec.loadBearing);
      if (!loadBearing || !(LOAD_BEARING as readonly string[]).includes(loadBearing)) {
        return problems.push(
          `assumptions[${i}].loadBearing was ${JSON.stringify(loadBearing)}, expected one of ${LOAD_BEARING.join(' | ')}`,
        );
      }

      const origin = str(rec.origin);
      if (!origin || !(ORIGIN as readonly string[]).includes(origin)) {
        return problems.push(
          `assumptions[${i}].origin was ${JSON.stringify(origin)}, expected "stated" or "implicit"`,
        );
      }

      // A dangling claim reference would break the assumption -> claim graph
      // the report and breaker engine both walk.
      const supports = Array.isArray(rec.supports)
        ? rec.supports.map(String).filter((s) => claimIds.has(s))
        : [];
      if (supports.length === 0 && claims.length > 0) {
        // Not fatal — attach to the first claim rather than dropping the
        // assumption, which would lose real signal over a formatting slip.
        supports.push(claims[0]!.id);
      }

      assumptions.push({
        id,
        statement,
        origin: origin as Assumption['origin'],
        supports,
        loadBearing: loadBearing as Assumption['loadBearing'],
        testability: testability as Testability,
        dataNeeded: str(rec.dataNeeded) ?? '',
        rationale: str(rec.rationale) ?? '',
      });
    });
  }

  if (problems.length > 0) {
    throw new MalformedOutputError(`Decomposition failed validation:\n- ${problems.join('\n- ')}`, raw);
  }

  const ambiguities = Array.isArray(root.ambiguities)
    ? root.ambiguities.map(String).filter((s) => s.trim().length > 0)
    : [];

  // Capability check runs only on assumptions claiming to be testable. Where
  // testability is already "none", dataNeeded is explaining what is missing, so
  // naming unavailable data there is exactly right.
  const softProblems: SoftProblem[] = [];
  for (const a of assumptions) {
    if (a.testability === 'none' || !a.dataNeeded) continue;
    for (const v of checkDataNeeded(a.dataNeeded)) {
      softProblems.push({
        assumptionId: a.id,
        message: `${a.id} is marked "${a.testability}" but its test cites "${v.matched}" — ${v.reason}. Either name a figure this system actually has, or set its testability to "none" and explain the gap in dataNeeded.`,
      });
    }
  }

  return { claims, assumptions, ambiguities, softProblems };
}

/**
 * Last-resort correction when repair attempts are exhausted.
 *
 * Fails toward honesty: an assumption wrongly marked untestable costs us a
 * breaker, while one wrongly marked testable hides a risk from the user. The
 * asymmetry is not close, so when in doubt we mark it untestable.
 */
export function downgradeUntestable(
  assumptions: Assumption[],
  softProblems: SoftProblem[],
): Assumption[] {
  const offenders = new Set(softProblems.map((p) => p.assumptionId));
  if (offenders.size === 0) return assumptions;

  return assumptions.map((a) =>
    offenders.has(a.id)
      ? {
          ...a,
          testability: 'none' as const,
          dataNeeded: `would require ${a.dataNeeded}, which is not available to this system`,
        }
      : a,
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
