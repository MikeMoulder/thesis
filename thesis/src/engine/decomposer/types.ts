/**
 * Thesis decomposition — turning a sentence into a structure.
 *
 * This runs before any research. Its job is purely structural: find what the
 * user is claiming, and find what must be true for those claims to hold. It
 * does not judge, weigh evidence, or argue. The bear seat attacks; the
 * decomposer only lays out the target.
 *
 * Keeping those separate matters. A decomposer that editorialises produces
 * assumptions shaped to be attacked, which quietly rigs the stress test.
 */

export interface ThesisInput {
  /** Underlying ticker, e.g. "NVDA". */
  ticker: string;
  /** The user's thesis in their own words. */
  thesis: string;
  /** Optional: "3 months", "through next earnings". */
  horizon?: string;
  /** Optional: what they are thinking of doing, e.g. "long rNVDA". */
  proposedTrade?: string;
}

/** What the user asserts will happen. The conclusion, not the reasoning. */
export interface Claim {
  id: string;
  statement: string;
  /** Direction of the bet, where one is expressed. */
  direction?: 'bullish' | 'bearish' | 'neutral';
}

/**
 * How an assumption could be tested against data we can actually retrieve.
 *
 * Deliberately constrained to our real capabilities. If this were open-ended,
 * the model would invent data sources — "check insider sentiment surveys" —
 * and produce breakers that can never be evaluated.
 */
export type Testability =
  /** Reported financials: revenue, margins, EPS. EDGAR. Moves quarterly. */
  | 'fundamental'
  /** Price, volatility, correlation, relative performance. Moves continuously. */
  | 'price'
  /** Discrete events: guidance, announcements, analyst actions, macro prints. */
  | 'event'
  /** No available data can test this. A real and important answer. */
  | 'none';

/** Maps directly onto thesis-breaker cadence — see engine/breakers. */
export const TESTABILITY_CADENCE: Record<Testability, 'periodic' | 'continuous' | 'event' | null> = {
  fundamental: 'periodic',
  price: 'continuous',
  event: 'event',
  none: null,
};

export interface Assumption {
  id: string;
  /** The assumption as a falsifiable statement. */
  statement: string;
  /**
   * Whether the user said this or whether it is hiding underneath what they
   * said. Implicit assumptions are the most valuable output of this step — they
   * are the load the user does not know they are carrying.
   */
  origin: 'stated' | 'implicit';
  /** Claim ids this assumption supports. */
  supports: string[];
  /**
   * How much of the thesis rests on this. If a 'high' assumption fails, the
   * thesis fails with it.
   */
  loadBearing: 'high' | 'medium' | 'low';
  testability: Testability;
  /** Concretely what would test it, phrased for the research seats. */
  dataNeeded: string;
  /** Why this assumption is load-bearing, or why it is implicit. */
  rationale: string;
}

export interface Decomposition {
  ticker: string;
  thesis: string;
  horizon?: string;
  proposedTrade?: string;
  claims: Claim[];
  assumptions: Assumption[];
  /** Model's note on anything ambiguous in the user's wording. */
  ambiguities: string[];
  summary: DecompositionSummary;
  meta: {
    model: string;
    latencyMs: number;
    decomposedAt: string;
  };
}

export interface DecompositionSummary {
  claimCount: number;
  assumptionCount: number;
  /** Assumptions with testability other than 'none'. */
  verifiableCount: number;
  /** Assumptions the user never stated. */
  implicitCount: number;
  /** High load-bearing assumptions that nothing can test — the danger zone. */
  unfalsifiableLoadBearing: string[];
}

/**
 * Derive the headline numbers rather than trusting the model to count.
 * Models are unreliable arithmetic engines and this is the first thing a user
 * reads.
 */
export function summarise(
  claims: Claim[],
  assumptions: Assumption[],
): DecompositionSummary {
  return {
    claimCount: claims.length,
    assumptionCount: assumptions.length,
    verifiableCount: assumptions.filter((a) => a.testability !== 'none').length,
    implicitCount: assumptions.filter((a) => a.origin === 'implicit').length,
    unfalsifiableLoadBearing: assumptions
      .filter((a) => a.testability === 'none' && a.loadBearing === 'high')
      .map((a) => a.id),
  };
}
