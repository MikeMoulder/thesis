import { REQUEST_TIMEOUT_MS, SEC_DATA_BASE, USER_AGENT } from '../config';
import {
  NoDataError,
  ProviderError,
  sourced,
  type DerivedMetric,
  type FundamentalPoint,
  type Instrument,
  type Sourced,
} from '../types';
import type { DerivedMetricName } from '../DataSource';

/**
 * SEC EDGAR XBRL — the fundamentals spine.
 *
 * Chosen over commercial APIs because it is the primary source. A claim here
 * resolves to an actual filing with an accession number a human can open, which
 * is the strongest citation THESIS can offer. Commercial feeds are a vendor's
 * copy of this data.
 *
 * What EDGAR does NOT provide: forward guidance (prose in 8-K exhibits) and
 * analyst consensus (proprietary). Those stay 'unverifiable' by design.
 */

interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, XbrlConcept>>;
}

interface XbrlConcept {
  label?: string;
  description?: string;
  units: Record<string, XbrlFact[]>;
}

interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

const factsCache = new Map<string, CompanyFacts>();

function requireCik(instrument: Instrument): string {
  if (!instrument.cik) {
    throw new NoDataError(
      `${instrument.ticker} has no SEC CIK — likely a foreign issuer without US filings`,
      'edgar',
    );
  }
  return instrument.cik;
}

async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const cached = factsCache.get(cik);
  if (cached) return cached;

  const url = `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(`Could not reach SEC EDGAR (${url})`, 'edgar', cause);
  }
  if (res.status === 404) throw new NoDataError(`No XBRL facts filed for CIK ${cik}`, 'edgar');
  if (res.status === 403) {
    throw new ProviderError(
      'SEC returned 403 — set SEC_USER_AGENT to a descriptive string with contact details',
      'edgar',
    );
  }
  if (!res.ok) throw new ProviderError(`SEC EDGAR HTTP ${res.status}`, 'edgar');

  const facts = (await res.json()) as CompanyFacts;
  factsCache.set(cik, facts);
  return facts;
}

/** Filings report the same concept under different taxonomies; check both. */
function findConcept(facts: CompanyFacts, concept: string): XbrlConcept | undefined {
  for (const taxonomy of ['us-gaap', 'ifrs-full', 'dei']) {
    const hit = facts.facts[taxonomy]?.[concept];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * A quarterly fact covers roughly 90 days. EDGAR mixes quarterly, annual and
 * year-to-date facts in the same array with no flag distinguishing them, so
 * duration is the only reliable filter.
 */
function isQuarterly(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
  return days >= 80 && days <= 100;
}

function isAnnual(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
  return days >= 350 && days <= 380;
}

/**
 * Keep the most recently filed version of each period — restatements supersede —
 * while remembering when the period was FIRST reported. See FundamentalPoint
 * for why both dates matter.
 */
interface PeriodRecord {
  /** The currently standing value — from the most recent filing. */
  fact: XbrlFact;
  /** When this period was first reported — the market's event date. */
  firstFiled: string;
}

function latestByPeriod(
  facts: XbrlFact[],
  filter: (f: XbrlFact) => boolean,
): Map<string, PeriodRecord> {
  const out = new Map<string, PeriodRecord>();
  for (const f of facts) {
    if (!filter(f)) continue;
    if (f.form !== '10-Q' && f.form !== '10-K') continue;

    const prev = out.get(f.end);
    if (!prev) {
      out.set(f.end, { fact: f, firstFiled: f.filed });
      continue;
    }
    out.set(f.end, {
      fact: Date.parse(f.filed) > Date.parse(prev.fact.filed) ? f : prev.fact,
      firstFiled:
        Date.parse(f.filed) < Date.parse(prev.firstFiled) ? f.filed : prev.firstFiled,
    });
  }
  return out;
}

/**
 * Reconstruct fiscal Q4.
 *
 * Issuers file 10-Qs for Q1–Q3 only; Q4 appears nowhere as a standalone
 * quarterly fact, because the 10-K reports the full year instead. Without this,
 * every quarterly series silently loses one quarter a year — which would make a
 * `periodic` thesis breaker skip an entire reporting period without saying so.
 *
 * Q4 = FY total − (Q1 + Q2 + Q3), derived only when all three quarters fall
 * inside the annual window. The result is flagged `derived` so nothing
 * downstream can present it as a filed number.
 */
function deriveQ4(
  annuals: Map<string, PeriodRecord>,
  quarters: Map<string, PeriodRecord>,
  concept: string,
  unit: string,
): FundamentalPoint[] {
  const derived: FundamentalPoint[] = [];
  const quarterList = [...quarters.values()].map((r) => r.fact);

  for (const record of annuals.values()) {
    const fy = record.fact;
    if (!fy.start) continue;
    if (quarters.has(fy.end)) continue; // Q4 already reported outright.

    const fyStart = Date.parse(fy.start);
    const fyEnd = Date.parse(fy.end);

    const inside = quarterList.filter((q) => {
      if (!q.start) return false;
      return Date.parse(q.start) >= fyStart && Date.parse(q.end) <= fyEnd;
    });

    // Anything other than exactly three means we cannot trust the subtraction:
    // a missing quarter would inflate Q4, a duplicate would deflate it.
    if (inside.length !== 3) continue;

    const sum = inside.reduce((acc, q) => acc + q.val, 0);
    const q4Start = inside
      .map((q) => q.end)
      .sort()
      .at(-1)!;

    derived.push({
      concept,
      start: q4Start,
      end: fy.end,
      value: fy.val - sum,
      unit,
      form: fy.form,
      accession: fy.accn,
      filed: fy.filed,
      // A reconstructed Q4 became knowable when the annual report landed, so
      // that is its event date even if the 10-K itself was later restated.
      firstFiled: record.firstFiled,
      fy: fy.fy,
      fp: 'Q4',
      derived: true,
      derivation: `FY total (${fy.form} ${fy.accn}) minus the three filed quarters ending ${inside
        .map((q) => q.end)
        .sort()
        .join(', ')}`,
    });
  }

  return derived;
}

/**
 * Shares outstanding, for turning a share price into a company valuation.
 *
 * Instantaneous rather than a duration: a share count is a fact about a MOMENT,
 * so these facts carry no `start` and the quarterly and annual filters discard
 * every one of them. They need their own path.
 *
 * `EntityCommonStockSharesOutstanding` is the cover page figure and is the most
 * current thing in the filing, which is why it is tried first. The balance sheet
 * tag is the fallback for filers that omit it.
 */
export async function getSharesOutstanding(instrument: Instrument): Promise<Sourced<number>> {
  const cik = requireCik(instrument);
  const facts = await fetchCompanyFacts(cik);

  /*
    Point in time first, then the weighted average.

    A count on a given date is the right number for a valuation. But filers with
    multiple share classes often do not publish a single combined figure at all:
    Meta reports neither cover page nor balance sheet share counts in company
    facts, because its Class A and Class B lines carry member axes that the
    aggregated endpoint drops.

    What every filer does report, because earnings per share depends on it, is
    the weighted average diluted count. It is a period AVERAGE rather than a
    closing figure, so it lags a fast-changing share count slightly, and
    provenance says so rather than passing it off as a point in time. A market
    value that is a fraction stale beats no market value at all.
  */
  const pointInTime = ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'];
  const weightedAverage = [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfSharesOutstandingBasic',
  ];

  for (const concept of [...pointInTime, ...weightedAverage]) {
    const node = findConcept(facts, concept);
    if (!node) continue;

    const unit = Object.keys(node.units)[0];
    if (!unit) continue;

    const isAverage = weightedAverage.includes(concept);
    const candidates = (node.units[unit] ?? [])
      // Instantaneous tags carry no start; the averages are duration facts, so
      // requiring no start would discard every one of them.
      .filter((f) => (isAverage ? true : !f.start) && f.end && f.val > 0)
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));

    const latest = candidates[candidates.length - 1];
    if (!latest) continue;

    return sourced(latest.val, {
      status: isAverage ? 'inferred' : 'sourced',
      source: `SEC ${latest.form} ${latest.accn}`,
      url: filingUrl(cik, latest.accn),
      asOf: latest.filed,
      confidence: isAverage ? 'moderate' : 'high',
      derivation: isAverage
        ? `${concept}: an average over the quarter ending ${latest.end}, not a closing count, because this filer reports no single combined share count`
        : `${concept} as of ${latest.end}`,
    });
  }

  throw new NoDataError(`${instrument.ticker} does not report shares outstanding`, 'edgar');
}

/**
 * Shares outstanding over time, dated by when each figure became KNOWABLE.
 *
 * The single latest count answers "what is this company worth today". A base
 * rate asks "how often has it traded this expensively before", and that needs
 * the count as it stood at each past moment. Pairing today's share count with a
 * price from three years ago would invent a valuation that never existed, which
 * is the same look-ahead error the historical backfill exists to avoid.
 *
 * Dated by `filed` rather than by period end, for the same reason everything
 * else here is: a share count from a quarter that closed in June was not known
 * to anybody until the filing landed in July.
 */
export async function getSharesOutstandingSeries(
  instrument: Instrument,
): Promise<Array<{ date: string; value: number }>> {
  const facts = await fetchCompanyFacts(requireCik(instrument));

  const concepts = [
    'EntityCommonStockSharesOutstanding',
    'CommonStockSharesOutstanding',
    'WeightedAverageNumberOfDilutedSharesOutstanding',
  ];

  // Keep the FIRST concept that yields a usable series, in preference order,
  // rather than merging. Mixing a cover page count with a weighted average
  // would make the series step up and down for reasons that are about tagging
  // rather than about the company.
  for (const concept of concepts) {
    const node = findConcept(facts, concept);
    if (!node) continue;
    const unit = Object.keys(node.units)[0];
    if (!unit) continue;

    const byDate = new Map<string, number>();
    for (const fact of node.units[unit] ?? []) {
      if (!fact.filed || fact.val <= 0) continue;
      // Latest filing for a given knowable date wins, as restatements do.
      byDate.set(fact.filed, fact.val);
    }

    const series = [...byDate.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (series.length > 0) return series;
  }

  throw new NoDataError(
    `${instrument.ticker} does not report a share count history`,
    'edgar',
  );
}

export async function getFundamentalSeries(
  instrument: Instrument,
  concept: string,
  opts: { periodType?: 'quarterly' | 'annual'; limit?: number } = {},
): Promise<Sourced<FundamentalPoint[]>> {
  /*
    A metric ALIAS ("revenue") resolves through every tag that figure can arrive
    under; a raw XBRL tag ("GrossProfit") is fetched as named.

    Accepting both keeps the DataSource interface unchanged while giving every
    caller the merged series. Callers used to pass raw tags with no fallback,
    which is how a company that changed tags produced a stale reading.
  */
  if (isConceptAlias(concept)) {
    const points = await seriesFor(instrument, concept, opts.limit ?? 12);
    const latest = points[points.length - 1]!;
    return sourced(points, {
      status: latest.derived ? 'inferred' : 'sourced',
      source: `SEC ${latest.form} ${latest.accession}`,
      url: filingUrl(requireCik(instrument), latest.accession),
      asOf: latest.filed,
      confidence: 'high',
      ...(points.some((p) => p.derived) && {
        derivation: 'some periods are reconstructed fiscal Q4 (FY minus Q1-Q3); the rest are as filed',
      }),
    });
  }

  const cik = requireCik(instrument);
  const facts = await fetchCompanyFacts(cik);
  const node = findConcept(facts, concept);

  if (!node) {
    throw new NoDataError(
      `${instrument.ticker} does not report XBRL concept "${concept}"`,
      'edgar',
    );
  }

  const { periodType = 'quarterly', limit = 12 } = opts;
  const unit = Object.keys(node.units)[0]!;
  const unitFacts = node.units[unit]!;

  const reported = latestByPeriod(unitFacts, periodType === 'annual' ? isAnnual : isQuarterly);

  const asPoints = ({ fact: f, firstFiled }: PeriodRecord): FundamentalPoint => ({
    concept,
    start: f.start,
    end: f.end,
    value: f.val,
    unit,
    form: f.form,
    accession: f.accn,
    filed: f.filed,
    firstFiled,
    fy: f.fy,
    fp: f.fp,
  });

  let all: FundamentalPoint[] = [...reported.values()].map(asPoints);

  // Quarterly series are incomplete without a reconstructed Q4.
  if (periodType === 'quarterly') {
    const annuals = latestByPeriod(unitFacts, isAnnual);
    all = all.concat(deriveQ4(annuals, reported, concept, unit));
  }

  const points: FundamentalPoint[] = all
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
    .slice(-limit);

  if (points.length === 0) {
    throw new NoDataError(
      `${instrument.ticker} reports "${concept}" but no ${periodType} periods matched`,
      'edgar',
    );
  }

  const latest = points[points.length - 1]!;
  const derivedCount = points.filter((p) => p.derived).length;

  return sourced(points, {
    // If the most recent point is a reconstructed Q4, the series as a whole is
    // no longer purely 'sourced' and must not be presented as such.
    status: latest.derived ? 'inferred' : 'sourced',
    source: `SEC ${latest.form} ${latest.accession}`,
    url: filingUrl(cik, latest.accession),
    asOf: latest.filed,
    confidence: 'high',
    ...(derivedCount > 0 && {
      derivation: `${derivedCount} of ${points.length} periods are reconstructed fiscal Q4 (FY minus Q1-Q3); the rest are as filed`,
    }),
  });
}

/** Human-openable link to the filing index. This is what makes a claim checkable. */
export function filingUrl(cik: string, accession: string): string {
  const bare = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${accession}-index.htm`;
}

/**
 * Which XBRL tags a figure can arrive under, for filers that do not agree.
 *
 * ## Why this is a list and why it is MERGED rather than raced
 *
 * Companies change tags. AMD reported revenue as `Revenues` until it adopted
 * ASC 606, and everything since arrives as
 * `RevenueFromContractWithCustomerExcludingAssessedTax`. Its `Revenues` node
 * still exists and still resolves, holding exactly two quarters, both from 2017.
 *
 * The previous rule was "try each in order, use the first that resolves", and
 * for AMD that returned the 2017 figures as the CURRENT revenue: $1.58B against
 * a real $11.54B, presented with a citation and no warning. Gross margin then
 * failed outright, because a 2026 gross profit has no 2017 revenue to divide by,
 * and that failure was the only visible symptom of a silent seven-times error
 * sitting underneath it.
 *
 * So every candidate is fetched and the results are MERGED by period. A filer
 * that switched tags mid-history gets one continuous series, which is also what
 * the historical base rates need. Where two tags report the same period, the one
 * filed most recently wins, on the same principle as a restatement.
 *
 * This map is the single source of truth. It used to be copied in three places
 * (here, `metrics.ts` and `evaluate.ts`) and two of those copies named one tag
 * each with no fallback at all.
 */
export const CONCEPT_CANDIDATES: Record<string, string[]> = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
  ],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  researchAndDevelopment: ['ResearchAndDevelopmentExpense'],
};

/**
 * How far behind the filer's own latest reporting a series may fall before it
 * stops counting as a current reading, in days.
 *
 * ## Why a tag that resolves is not automatically a tag that is current
 *
 * Merging candidates fixes a filer that MOVED to a new tag, because the new tag
 * carries newer periods and wins. It does nothing for a tag that was simply
 * ABANDONED with no replacement in our candidate list. Amazon's `GrossProfit`
 * node holds four quarters from 2008 and 2009 and nothing since; read straight,
 * it reported $1.27B of gross profit for a company currently turning over
 * $200B a quarter, dated to September 2009 and presented as the latest figure.
 *
 * Roughly 15 months, so a filer that is merely late, or one whose annual figure
 * lands well after the quarterly, is not wrongly discarded. Anything further
 * behind than that is not a reading, it is history.
 */
const STALE_AFTER_DAYS = 460;

/** The most recent period this filer has reported anything at all for. */
async function latestReportedPeriod(instrument: Instrument): Promise<string | null> {
  const facts = await fetchCompanyFacts(requireCik(instrument));
  let latest: string | null = null;
  for (const taxonomy of Object.values(facts.facts ?? {})) {
    for (const node of Object.values(taxonomy)) {
      for (const unitFacts of Object.values(node.units ?? {})) {
        for (const fact of unitFacts) {
          if (fact.end && (latest === null || fact.end > latest)) latest = fact.end;
        }
      }
    }
  }
  return latest;
}

/** True when this name is one of our metric aliases rather than a raw XBRL tag. */
export function isConceptAlias(concept: string): boolean {
  return Object.hasOwn(CONCEPT_CANDIDATES, concept);
}

/**
 * Every candidate tag, merged into one series keyed by period end.
 *
 * Failures are tolerated: a filer that never used a tag simply contributes
 * nothing. Only when NO candidate resolves does this throw.
 */
async function mergedSeries(
  instrument: Instrument,
  keys: string[],
  limit: number,
): Promise<FundamentalPoint[]> {
  const settled = await Promise.allSettled(
    keys.map((concept) => getFundamentalSeries(instrument, concept, { limit })),
  );

  const byEnd = new Map<string, FundamentalPoint>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const point of result.value.value) {
      const existing = byEnd.get(point.end);
      // Most recently filed wins, exactly as a restatement does.
      if (!existing || point.firstFiled > existing.firstFiled) byEnd.set(point.end, point);
    }
  }

  if (byEnd.size === 0) {
    const firstError = settled.find((r) => r.status === 'rejected');
    throw firstError && firstError.status === 'rejected'
      ? (firstError.reason as Error)
      : new NoDataError(`No concept matched ${keys.join(', ')}`, 'edgar');
  }

  return [...byEnd.values()]
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
    .slice(-limit);
}

/** Cost of sales, under whichever tag the filer uses. Used to derive gross profit. */
const COST_OF_REVENUE = [
  'CostOfRevenue',
  'CostOfGoodsAndServicesSold',
  'CostOfServices',
  'CostOfGoodsSold',
];

/**
 * A metric's series, including the ones that have to be computed.
 *
 * `GrossProfit` is not a required line item and plenty of large filers simply
 * do not tag it. Meta reports revenue and `CostOfRevenue` and no gross profit at
 * all, so every gross margin question about it came back "nothing can check
 * this" when the two numbers needed to answer it were sitting right there.
 *
 * Subtracting them is arithmetic the filing supports, so it is done here and
 * MARKED as derived. The alternative is telling a user we cannot see something
 * we can see.
 */
async function seriesFor(
  instrument: Instrument,
  key: string,
  limit: number,
): Promise<FundamentalPoint[]> {
  let stale: Error | null = null;
  try {
    const points = await mergedSeries(instrument, CONCEPT_CANDIDATES[key] ?? [key], limit);

    // A tag can resolve and still be dead. See STALE_AFTER_DAYS.
    const reference = await latestReportedPeriod(instrument);
    const newest = points[points.length - 1]!.end;
    if (reference && Date.parse(reference) - Date.parse(newest) > STALE_AFTER_DAYS * 86_400_000) {
      stale = new NoDataError(
        `${instrument.ticker} last tagged ${key} for ${newest}, but has reported through ` +
          `${reference}. Treating that tag as abandoned rather than as current.`,
        'edgar',
      );
      throw stale;
    }

    return points;
  } catch (err) {
    if (key !== 'grossProfit') throw err;

    // Gross profit is not reported. Revenue minus cost of sales is the same
    // figure, and both inputs come from the same filed period.
    const [revenue, cost] = await Promise.all([
      mergedSeries(instrument, CONCEPT_CANDIDATES.revenue!, limit),
      mergedSeries(instrument, COST_OF_REVENUE, limit),
    ]);

    const costByEnd = new Map(cost.map((c) => [c.end, c]));
    const out: FundamentalPoint[] = [];
    for (const r of revenue) {
      const c = costByEnd.get(r.end);
      if (!c) continue;
      out.push({
        ...r,
        concept: 'GrossProfit',
        value: r.value - c.value,
        derived: true,
        derivation: `revenue minus ${c.concept}; this filer does not tag GrossProfit`,
        // Knowable only once BOTH inputs were filed.
        firstFiled: r.firstFiled > c.firstFiled ? r.firstFiled : c.firstFiled,
      });
    }

    if (out.length === 0) throw err;
    return out;
  }
}

const RATIO_INPUTS: Record<DerivedMetricName, [string, string] | null> = {
  grossMargin: ['grossProfit', 'revenue'],
  operatingMargin: ['operatingIncome', 'revenue'],
  netMargin: ['netIncome', 'revenue'],
  revenueGrowthYoY: null,
};

/**
 * Derived ratios are always 'inferred': the filing reported the inputs, we did
 * the arithmetic. The inputs stay attached so the UI can show the workings.
 */
export async function getDerivedMetric(
  instrument: Instrument,
  metric: DerivedMetricName,
  opts: { limit?: number } = {},
): Promise<Sourced<DerivedMetric[]>> {
  const limit = opts.limit ?? 12;

  if (metric === 'revenueGrowthYoY') {
    // Needs 4 extra quarters to compare against.
    const rev = await seriesFor(instrument, 'revenue', limit + 4);
    const out: DerivedMetric[] = [];
    for (let i = 4; i < rev.length; i++) {
      const cur = rev[i]!;
      const prior = rev[i - 4]!;
      if (prior.value === 0) continue;
      out.push({
        name: metric,
        end: cur.end,
        value: ((cur.value - prior.value) / Math.abs(prior.value)) * 100,
        unit: 'percent',
        inputs: [prior, cur],
      });
    }
    return finishDerived(out.slice(-limit), instrument, metric, 'year-over-year change in reported revenue');
  }

  const pair = RATIO_INPUTS[metric]!;
  const [numeratorKey, denominatorKey] = pair;
  const [numerator, denominator] = await Promise.all([
    seriesFor(instrument, numeratorKey, limit + 4),
    seriesFor(instrument, denominatorKey, limit + 4),
  ]);

  const denomByEnd = new Map(denominator.map((d) => [d.end, d]));
  const out: DerivedMetric[] = [];
  for (const n of numerator) {
    const d = denomByEnd.get(n.end);
    if (!d || d.value === 0) continue;
    out.push({
      name: metric,
      end: n.end,
      value: (n.value / d.value) * 100,
      unit: 'percent',
      inputs: [n, d],
    });
  }

  return finishDerived(
    out.slice(-limit),
    instrument,
    metric,
    `${numeratorKey} / ${denominatorKey} from the same filed period`,
  );
}

function finishDerived(
  points: DerivedMetric[],
  instrument: Instrument,
  metric: string,
  derivation: string,
): Sourced<DerivedMetric[]> {
  if (points.length === 0) {
    throw new NoDataError(`Could not derive ${metric} for ${instrument.ticker}`, 'edgar');
  }
  const latest = points[points.length - 1]!;
  const cite = latest.inputs[0]!;
  // A ratio built on a reconstructed Q4 inherits that uncertainty.
  const usesDerivedQ4 = points.some((p) => p.inputs.some((i) => i.derived));

  return sourced(points, {
    status: 'inferred',
    source: `Computed from SEC ${cite.form} ${cite.accession}`,
    url: instrument.cik ? filingUrl(instrument.cik, cite.accession) : undefined,
    asOf: cite.filed,
    confidence: usesDerivedQ4 ? 'moderate' : 'high',
    derivation: usesDerivedQ4
      ? `${derivation}; some periods use a reconstructed fiscal Q4`
      : derivation,
  });
}

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    // NVDA — a filer guaranteed to have current XBRL facts.
    await fetchCompanyFacts('0001045810');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - t0 };
  }
}
