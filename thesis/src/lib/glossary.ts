import type { Metric } from '@/engine/breakers/types';

/**
 * Plain English for everything this product says.
 *
 * THESIS is built on filings and market data, and the vocabulary that comes
 * with those is not the reader's fault. Somebody who has never traded should be
 * able to follow every line on the page — not by us dumbing the analysis down,
 * but by saying what the words mean where they are used.
 *
 * Rules for writing these:
 *   - describe the thing, do not define the term with more terms
 *   - concrete over precise: "what's left after making the product" beats
 *     "revenue less cost of goods sold"
 *   - one sentence for `short`, which is what appears inline
 *   - no jargon inside a definition, ever
 */

export interface Definition {
  /** The human name, used in place of the identifier. */
  label: string;
  /** One sentence. Appears inline on hover or tap. */
  short: string;
  /** Optional second sentence: why a trader would care. */
  why?: string;
  /** What "normal" looks like, so a number has somewhere to sit. */
  typical?: string;
}

export const METRIC_GLOSSARY: Record<Metric, Definition> = {
  revenue: {
    label: 'revenue',
    short: 'All the money the company took in over three months, before any costs.',
    why: 'It is the top line — everything else is what happens to it on the way down.',
  },
  grossProfit: {
    label: 'gross profit',
    short: 'What is left from sales after paying to actually make the product.',
    why: 'Before salaries, research, or tax. It shows whether the product itself makes money.',
  },
  operatingIncome: {
    label: 'operating income',
    short: 'Profit from running the business, after wages and research but before tax and interest.',
  },
  netIncome: {
    label: 'net income',
    short: 'What is left after absolutely everything, including tax. The bottom line.',
  },
  eps: {
    label: 'earnings per share',
    short: "Net profit divided by the number of shares — one share's slice of the profit.",
  },
  researchAndDevelopment: {
    label: 'R&D spending',
    short: 'What the company spent building new products over three months.',
  },
  grossMargin: {
    label: 'gross margin',
    short: 'Of every $100 of sales, how much is left after making the product.',
    why: 'High margin means pricing power. When it falls, the company is discounting or its costs are rising.',
    typical: 'Software runs 70–90%. Carmakers run 15–25%. It varies enormously by industry.',
  },
  operatingMargin: {
    label: 'operating margin',
    short: 'Of every $100 of sales, how much survives running the whole business.',
    why: 'Gross margin shows the product works. This shows the company around it works.',
  },
  netMargin: {
    label: 'net margin',
    short: 'Of every $100 of sales, how much is still there after everything including tax.',
  },
  revenueGrowthYoY: {
    label: 'revenue growth',
    short: 'How much bigger sales are than the same three months a year earlier.',
    why: 'Compared against a year ago rather than last quarter, so Christmas is not mistaken for growth.',
    typical: 'A mature company grows 5–10%. Anything above 50% is unusual and rarely lasts.',
  },
  price: {
    label: 'price',
    short: 'What one share last traded at.',
  },
  return30d: {
    label: '30-day return',
    short: 'How much the share price has moved over the past month, as a percentage.',
  },
  return90d: {
    label: '90-day return',
    short: 'How much the share price has moved over the past three months, as a percentage.',
  },
  drawdownFromHigh: {
    label: 'drawdown',
    short: 'How far the price has fallen below its highest point in the past year.',
    why: 'Always zero or negative. 0% means sitting at the high; −25% means a quarter below it.',
    typical: 'Ordinary shares dip 10–20% regularly. Below −30% is a serious decline.',
  },
  marketCap: {
    label: 'market value',
    short: 'What the whole company costs at the current share price.',
    why: 'Share price on its own says nothing about size. A $10 share can be a bigger company than a $500 one.',
  },
  trailingPE: {
    label: 'price to earnings',
    short: 'How many years of current profit you are paying for one share.',
    why: 'A high number means the market expects growth. That expectation is the thing your thesis is usually betting against.',
    typical: 'The wider market sits near 20. Fast growers run 30 to 60. Above that, a lot of future is already in the price.',
  },
  priceToSales: {
    label: 'price to sales',
    short: 'How many years of revenue you are paying for one share.',
    why: 'Useful where profit is small or negative, which is where price to earnings stops working.',
  },
  earningsYield: {
    label: 'earnings yield',
    short: 'Last year of profit as a percentage of the share price.',
    why: 'Price to earnings turned upside down, so it can be compared with a bond yield or a savings rate.',
  },
  volatility90d: {
    label: 'volatility',
    short: 'How violently the price has been swinging around, as a yearly percentage.',
    why: 'Not direction — size of movement. High volatility means large moves in both directions.',
    typical: 'A steady large company runs 15–25%. A fast-moving tech share can run 40–60%.',
  },
  spreadBps: {
    label: 'spread',
    short: 'The gap between the best price someone will buy at and the best price someone will sell at.',
    why: 'You pay half of it going in and half coming out. It is the toll for entering a position at all.',
    typical: 'rNVDA runs under 1 basis point. Thinner rTokens run 15 to 20, which is twenty times the cost.',
  },
  exitDepthUsd: {
    label: 'exit depth',
    short: 'How many dollars of real buy orders are sitting close enough to sell into right now.',
    why: 'This is the money that would actually be there if you tried to get out. Zero means nobody is bidding, whatever the price on the screen says.',
    typical: 'rNVDA has around 830,000 dollars waiting. Half the listed rTokens have nothing at all.',
  },
  exitSlippageBps: {
    label: 'exit cost',
    short: 'What it would really cost to sell 25,000 dollars right now, compared with the price on screen.',
    why: 'The screen price is for a tiny trade. This is the price for your trade, and on a thin book the two are not close.',
    typical: 'rNVDA costs about 0.4 basis points. rKO costs about 45, which is a hundred times more.',
  },
};

/** Vocabulary the product itself invents, which needs explaining just as much. */
export const CONCEPT_GLOSSARY: Record<string, Definition> = {
  thesis: {
    label: 'thesis',
    short: 'Your reason for making a trade — the story you believe about why it works.',
  },
  assumption: {
    label: 'assumption',
    short: 'Something that has to be true for your reason to hold up.',
    why: 'Most are never said out loud, which is exactly why they go unchecked.',
  },
  implicit: {
    label: 'implicit',
    short: 'You did not say this, but your reasoning depends on it anyway.',
    why: 'These are the most useful thing here — you cannot check a belief you do not know you hold.',
  },
  stated: {
    label: 'stated',
    short: 'You said this yourself, in your own words.',
  },
  loadBearing: {
    label: 'load-bearing',
    short: 'How much of your reasoning collapses if this one thing turns out to be wrong.',
    why: 'High means the whole trade goes with it. Low means it would sting but survive.',
  },
  tripwire: {
    label: 'tripwire',
    short: 'A specific number that, if crossed, tells you an assumption just broke.',
    why: 'Not a prediction. A tripwire is set in advance so you find out from data rather than from the price.',
  },
  untestable: {
    label: 'untestable',
    short: 'No data this system can reach would ever tell you whether this is true.',
    why: 'It does not mean the assumption is wrong. It means you are trusting it, and should know that.',
  },
  headroom: {
    label: 'headroom',
    short: 'How far the current reading is from the level that would trip the wire.',
    why: 'A little headroom means it could go at the next report. A lot means it is nowhere near.',
  },
  baseRate: {
    label: 'base rate',
    short: 'What actually happened the other times this same condition was true, historically.',
    why: 'It replaces a guess about how serious something is with a count of what followed.',
  },
  inherited: {
    label: 'inherited',
    short: 'This seriousness rating is an opinion, carried over from how much the thesis leans on it.',
    why: 'Not measured from history yet. Open the base rates to replace the opinion with a record.',
  },
  measured: {
    label: 'measured',
    short: 'This seriousness rating came from counting what happened before, not from an opinion.',
  },
  periodic: {
    label: 'periodic',
    short: 'Can only change when the company files its next quarterly report.',
    why: 'Roughly every three months. The price can move all it likes in between; this will not.',
  },
  continuous: {
    label: 'continuous',
    short: 'Can change at any moment, because it is based on the live price.',
  },
  event: {
    label: 'event',
    short: 'Waiting on something happening and being reported, rather than on a number.',
  },
  sourced: {
    label: 'sourced',
    short: 'Taken straight from a document, with a link to it.',
  },
  inferred: {
    label: 'inferred',
    short: 'Calculated by this system from documents, rather than read off one directly.',
  },
  unverifiable: {
    label: 'unverifiable',
    short: 'No reliable evidence could be found for this at all.',
  },
};

export function defineMetric(metric: Metric): Definition {
  return METRIC_GLOSSARY[metric];
}

/**
 * A metric's name as a person would say it, for use inside a sentence.
 *
 * Engine identifiers leak into user-facing prose surprisingly easily: a data
 * provider throws "Could not derive grossMargin for AMD" and that string is
 * shown verbatim under a heading about what to do next. `grossMargin` is a
 * property name, not a phrase, and camel case in the middle of a sentence tells
 * a reader they have wandered into somebody else's debug output.
 *
 * Falls back to splitting the camel case, so a metric added without a glossary
 * entry still reads as words rather than as code.
 */
export function metricPhrase(metric: string): string {
  const known = METRIC_GLOSSARY[metric as Metric];
  if (known) return known.label;
  return metric
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase();
}

/**
 * Rewrite engine metric identifiers inside a free-text string.
 *
 * Matches the KNOWN metric names first, by name, because not all of them are
 * camel case: `volatility90d` has no capital letter in it and a camel case
 * pattern walks straight past it. The generic pattern is kept as a fallback for
 * identifiers that are not metrics at all.
 */
export function humaniseMetrics(text: string): string {
  const names = Object.keys(METRIC_GLOSSARY).sort((a, b) => b.length - a.length);
  const known = new RegExp('\\b(' + names.join('|') + ')\\b', 'g');
  return text
    .replace(known, (match) => metricPhrase(match))
    .replace(/\b[a-z]+(?:[A-Z][a-zA-Z0-9]*)+\b/g, (match) => metricPhrase(match));
}

export function defineConcept(key: string): Definition | undefined {
  return CONCEPT_GLOSSARY[key];
}
