/**
 * Programmatic enforcement of what data this system actually has.
 *
 * The prompt already tells the model what is available. It leaks anyway —
 * observed roughly once in nine assumptions. A live run proposed testing an
 * assumption with "automotive gross profit divided by automotive revenue",
 * which is a segment breakout we do not extract, and an earlier run proposed
 * "consensus analyst price targets", which does not exist at all.
 *
 * That failure mode is the dangerous one: it turns an untestable, load-bearing
 * assumption into one that looks verified, hiding the exact risk the user
 * needed to see. Prompts are guidance; this file is enforcement.
 */

export interface CapabilityViolation {
  /** The offending phrase, as it appeared. */
  matched: string;
  /** Why it is not available, phrased for the repair prompt. */
  reason: string;
}

interface Rule {
  pattern: RegExp;
  reason: string;
  /**
   * Set where a company-wide figure is a legitimate stand-in. Naming the
   * unavailable thing is then correct, not a violation — "company-wide gross
   * margin as a proxy for automotive margin" is exactly the honest phrasing we
   * want, and blocking it would push the model into marking everything
   * untestable and starving the breaker engine.
   *
   * Deliberately not set on consensus, price targets or market share: no
   * figure we hold responds to those, so no proxy is honest.
   */
  allowIfProxy?: boolean;
}

/** Does the text openly declare a substitution rather than hide one? */
function declaresProxy(text: string): boolean {
  return /\b(as a proxy|proxy for|stand-?in for|substitut)/i.test(text);
}

/**
 * Is the unavailable thing being DISCLAIMED rather than relied on?
 *
 * These rules exist to catch a model quietly testing an assumption with data we
 * do not hold. They were also firing on the exact opposite behaviour: text that
 * names the missing data precisely in order to say it is NOT being used.
 *
 * Observed live, and it is what held this whole capability back. Asked about AMD
 * being mispriced, the decomposer correctly proposed trailing price to earnings
 * and then wrote:
 *
 *   "...this measures current valuation multiples RATHER THAN market
 *    expectations or forward multiples, WHICH IS NOT AVAILABLE to this system"
 *
 * That is precisely the honest phrasing this product asks for everywhere else.
 * It matched the forward-multiple rule, counted as a violation, and the
 * assumption came back marked untestable with its own correct reasoning sitting
 * unused in the gap field. **Punishing a disclaimer teaches the model to stop
 * disclaiming**, which is the last thing this system wants.
 *
 * Scoped to the CLAUSE containing the match, so a disclaimer in one half of a
 * sentence cannot excuse genuine reliance in the other half. Only two markers
 * count, both unambiguous: an explicit contrast, or an explicit statement that
 * the thing is not available.
 */
function disclaims(text: string, index: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf(';', index),
    text.lastIndexOf(',', index),
    text.lastIndexOf('.', index),
  );
  const rest = text.slice(index).search(/[;.]/);
  const clauseEnd = rest === -1 ? text.length : index + rest;
  const clause = text.slice(clauseStart + 1, clauseEnd);

  const contrasts = /\b(rather than|instead of|as opposed to|not just)\b/i.test(clause);
  const declaredMissing = /\b(not available|unavailable|not accessible|we do not have)\b/i.test(clause);
  return contrasts || declaredMissing;
}

/**
 * Note what is deliberately NOT here: "forward guidance" and "guidance" are
 * legitimate — guidance is announced publicly and is testable as an `event`.
 * Only forward *estimates produced by third parties* are unavailable.
 */
const RULES: Rule[] = [
  {
    pattern: /\b(consensus|street\s+estimate|whisper\s+number)\b/i,
    reason: 'analyst consensus data is not available to this system',
  },
  {
    pattern: /\banalyst\s+(estimate|forecast|target|rating|projection)s?\b/i,
    reason: 'analyst estimates and targets are not available to this system',
  },
  {
    pattern: /\bprice\s+target/i,
    reason: 'price targets are not available to this system',
  },
  {
    pattern: /\bforward\s+(p\/?e|multiple|earnings|estimate|revenue|eps)/i,
    reason: 'forward estimates and forward multiples are not available to this system',
  },
  {
    pattern: /\bmarket\s+share\b/i,
    reason: 'market share figures are not available to this system',
  },
  {
    pattern: /\b(industry|third-?party|broker)\s+(report|research|estimate)s?\b/i,
    reason: 'third-party industry research is not available to this system',
  },
  {
    pattern: /\b(backlog|bookings|order\s+book|channel\s+check|survey)\b/i,
    reason: 'backlog, bookings and channel data are not available to this system',
  },
  {
    pattern: /\b(segment|division|business\s+unit|product\s+line)\b/i,
    reason: 'segment-level breakouts are not extracted; only company totals are available',
    allowIfProxy: true,
  },
  /**
   * Catches segment breakouts that never say "segment" — the observed failures
   * were "automotive revenue" and "automotive gross margin".
   *
   * The optional middle word is what makes it catch the second form: the
   * qualifier and the financial noun are often separated ("automotive GROSS
   * margin", "data center OPERATING income"). Anchored to a known segment
   * qualifier so it stays quiet on ordinary phrasing like "quarterly revenue"
   * or "total gross margin".
   */
  {
    pattern:
      /\b(automotive|energy|data\s?cent(?:er|re)|cloud|services|advertising|gaming|hardware|software|subscription|regional|geographic)\s+(?:\w+\s+)?(revenue|sales|profit|margin|income|earnings)\b/i,
    reason:
      'that is a segment-level figure; only company-wide totals are extracted from filings',
    allowIfProxy: true,
  },
];

/**
 * Check a testable assumption's dataNeeded against real capabilities.
 * Assumptions already marked untestable are exempt — there, dataNeeded is
 * explaining what is missing, so naming unavailable data is correct.
 */
export function checkDataNeeded(dataNeeded: string): CapabilityViolation[] {
  const violations: CapabilityViolation[] = [];
  const proxied = declaresProxy(dataNeeded);

  for (const rule of RULES) {
    if (rule.allowIfProxy && proxied) continue;
    const hit = rule.pattern.exec(dataNeeded);
    if (!hit) continue;
    // Naming the missing thing in order to rule it OUT is honest, not a breach.
    if (disclaims(dataNeeded, hit.index)) continue;
    violations.push({ matched: hit[0], reason: rule.reason });
  }
  return violations;
}
