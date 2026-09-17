import { FUNDAMENTAL_METRICS, PRICE_METRICS, type Metric } from './breakers/types';
import type { Scenario } from './breakers/evaluate';

/**
 * Turn "what if gross margin falls to 62%?" into { grossMargin: 62 }.
 *
 * Deterministic on purpose. Routing a follow-up through a model to decide what
 * kind of question it is means a misroute in a live demo — a judge types a
 * scenario and gets a paragraph. It also means paying for a model call to
 * answer a question the evaluator can settle for free.
 *
 * So the rule is: if a message names metrics we can evaluate AND gives numbers
 * for them, it is a scenario. Anything else falls through to the follow-up
 * seat. The parser never guesses — an unrecognised phrase yields nothing rather
 * than a best-effort match, because a wrong metric silently answers a question
 * nobody asked.
 */

/** Natural phrasings mapped to the closed metric vocabulary. Longest first. */
const PHRASES: Array<[RegExp, Metric]> = [
  [/\b(?:yoy\s+)?revenue\s+growth\b|\brevenue\s+growth\s+(?:rate|yoy)\b|\bgrowth\s+rate\b/i, 'revenueGrowthYoY'],
  [/\bgross\s+margins?\b/i, 'grossMargin'],
  [/\boperating\s+margins?\b/i, 'operatingMargin'],
  [/\bnet\s+margins?\b/i, 'netMargin'],
  [/\boperating\s+income\b/i, 'operatingIncome'],
  [/\bnet\s+income\b/i, 'netIncome'],
  [/\bgross\s+profit\b/i, 'grossProfit'],
  [/\br\s*&\s*d\b|\bresearch\s+and\s+development\b/i, 'researchAndDevelopment'],
  [/\bdraw\s*down\b/i, 'drawdownFromHigh'],
  [/\bvolatility\b|\bvol\b/i, 'volatility90d'],
  [/\b30[- ]?day\s+return\b/i, 'return30d'],
  [/\b90[- ]?day\s+return\b/i, 'return90d'],
  [/\beps\b|\bearnings\s+per\s+share\b/i, 'eps'],
  [/\brevenues?\b/i, 'revenue'],
  [/\bprice\b/i, 'price'],
];

const KNOWN = new Set<string>([...FUNDAMENTAL_METRICS, ...PRICE_METRICS]);

/** Words that mean the number is a fall, so a bare "30%" becomes -30. */
const DOWNWARD = /\b(?:falls?|fell|drops?|declines?|down|below|under|loses?|cuts?)\b/i;

export interface ParsedScenario {
  scenario: Scenario;
  /** The metric names understood, in the order they appeared. */
  matched: Metric[];
}

/**
 * Find "<metric phrase> ... <number>" pairs.
 *
 * Scans metric-first rather than number-first: a sentence contains more numbers
 * than metrics ("what if gross margin falls to 62% over the next 2 quarters"),
 * and anchoring on the metric avoids binding "2 quarters" to anything.
 */
export function parseScenario(message: string): ParsedScenario | null {
  const scenario: Scenario = {};
  const matched: Metric[] = [];

  /*
    Phrases are consumed as they match: once "revenue growth" is claimed, those
    characters are blanked out so the more general "revenue" pattern later in the
    list cannot match the same words again. Without this, "revenue growth falls
    to 20%" yields BOTH revenueGrowthYoY 20 and a phantom revenue -20, and the
    scenario silently asserts something the user never said.
  */
  let remaining = message;

  for (const [pattern, metric] of PHRASES) {
    if (!KNOWN.has(metric)) continue;
    if (metric in scenario) continue;

    const hit = pattern.exec(remaining);
    if (!hit) continue;

    // Look only at the text after the metric phrase, so two metrics in one
    // sentence do not steal each other's number.
    const after = remaining.slice(hit.index + hit[0].length);
    const number = /(-?\d+(?:\.\d+)?)\s*%?/.exec(after);
    if (!number?.[1]) continue;

    let value = Number.parseFloat(number[1]);
    if (!Number.isFinite(value)) continue;

    // "drawdown of 30%" means -30: the metric is defined as zero-or-negative,
    // and a positive 30 would be a condition that can never hold.
    if (metric === 'drawdownFromHigh' && value > 0) value = -value;

    // "revenue growth falls 15%" reads as a fall to a negative rate only when
    // the sentence says so; "falls to 15%" is a level. Distinguish on "to".
    if (value > 0 && metric !== 'drawdownFromHigh') {
      const windowText = remaining.slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 12);
      const isLevel = /\bto\b|\bat\b|\bof\b|=|\bhits?\b|\breaches?\b/i.test(windowText);
      if (!isLevel && DOWNWARD.test(windowText)) value = -value;
    }

    scenario[metric] = value;
    matched.push(metric);

    // Blank the phrase so a broader pattern cannot re-claim these characters.
    remaining =
      remaining.slice(0, hit.index) +
      ' '.repeat(hit[0].length) +
      remaining.slice(hit.index + hit[0].length);
  }

  return matched.length > 0 ? { scenario, matched } : null;
}

/** Human-readable summary, e.g. "grossMargin 62%, revenueGrowthYoY 15%". */
export function describeScenario(parsed: ParsedScenario): string {
  return parsed.matched
    .map((metric) => {
      const value = parsed.scenario[metric];
      const percent = /Margin|Growth|return|volatility|drawdown/i.test(metric);
      return `${metric} ${value}${percent ? '%' : ''}`;
    })
    .join(', ');
}
