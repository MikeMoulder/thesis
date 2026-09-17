import { CitationChip } from '@/components/evidence/CitationChip';
import { Metric, Prose, Term, Value, Warn } from '@/components/prose/emphasis';
import type { Provenance } from '@/data/types';

/**
 * Component lab. Not linked from the product; a working surface for judging
 * components in realistic context rather than in isolation.
 */

const filing: Provenance = {
  status: 'sourced',
  source: 'SEC 10-Q 0001045810-26-000075',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm',
  asOf: '2026-08-26',
  confidence: 'high',
};

const derivedRatio: Provenance = {
  status: 'inferred',
  source: 'SEC 10-Q 0001045810-26-000075',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm',
  asOf: '2026-08-26',
  confidence: 'high',
  derivation: 'GrossProfit ÷ Revenues, both from the same filing',
};

const reconstructedQ4: Provenance = {
  status: 'inferred',
  source: 'SEC 10-K 0001045810-26-000021',
  url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K',
  asOf: '2026-02-26',
  confidence: 'moderate',
  derivation: 'Q4 reconstructed as FY − (Q1+Q2+Q3). Not a filed quarterly figure.',
};

const marketQuote: Provenance = {
  status: 'sourced',
  source: 'Bitget Agent Hub · spot ticker RNVDAUSDT',
  asOf: '2026-09-16',
  confidence: 'high',
};

const underlying: Provenance = {
  status: 'sourced',
  source: 'Yahoo Finance chart · NVDA daily',
  asOf: '2026-09-15',
  confidence: 'high',
};

const noEvidence: Provenance = {
  status: 'unverifiable',
  source: 'none',
  derivation: 'Requires analyst consensus and forward multiples, which this system cannot reach.',
  confidence: 'low',
};

/**
 * One labelled figure with its citation.
 *
 * The figure sits in a fixed-width right-aligned cell so that a column of them
 * lines up regardless of how long each citation is. Without that, "74.98%" and
 * "$214.92" land at different x positions and the column stops being scannable
 * — which is the whole reason for tabular figures in the first place.
 */
function Figure({
  label,
  value,
  provenance,
  showDerivation = false,
}: {
  label: string;
  value: string;
  provenance: Provenance;
  showDerivation?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm text-muted">{label}</span>
      <span data-figure className="w-24 shrink-0 text-right text-base text-text">
        {value}
      </span>
      <span className="flex w-60 shrink-0 flex-col gap-0.5">
        <CitationChip provenance={provenance} />
        {showDerivation && provenance.derivation ? (
          <span className="text-meta leading-snug text-faint">{provenance.derivation}</span>
        ) : null}
      </span>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-meta uppercase tracking-[0.14em] text-faint">{title}</h2>
      {note ? <div className="mt-1.5 text-sm">{note}</div> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function LabPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Component lab</p>
      <h1 className="mt-1 text-xl font-medium">Citation chip</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Every figure in THESIS carries one. Two icons: how far to trust the number, and what kind of
        thing produced it.
      </p>

      <Section
        title="In context"
        note="The real test. Read down the column of figures — the citations should sit underneath them, not compete with them."
      >
        <Figure label="Gross margin" value="74.98%" provenance={derivedRatio} />
        <Figure label="Revenue, quarter" value="$46.74B" provenance={filing} />
        <Figure label="Revenue, FY Q4" value="$39.33B" provenance={reconstructedQ4} />
        <Figure label="rNVDA last" value="$214.92" provenance={marketQuote} />
        <Figure label="Drawdown from high" value="−10.81%" provenance={underlying} />
        <Figure label="Priced-in expectations" value="—" provenance={noEvidence} />
      </Section>

      <Section
        title="With derivation shown"
        note="Used where a derived number could be mistaken for a filed one. A reconstructed quarter must never render like a reported quarter."
      >
        <Figure
          label="Revenue, FY Q4"
          value="$39.33B"
          provenance={reconstructedQ4}
          showDerivation
        />
        <Figure
          label="Priced-in expectations"
          value="—"
          provenance={noEvidence}
          showDerivation
        />
      </Section>

      <Section title="All states, bare">
        <div className="flex flex-col gap-2.5 py-1">
          <CitationChip provenance={filing} />
          <CitationChip provenance={derivedRatio} />
          <CitationChip provenance={reconstructedQ4} />
          <CitationChip provenance={marketQuote} />
          <CitationChip provenance={underlying} />
          <CitationChip provenance={noEvidence} />
        </div>
      </Section>

      <Section
        title="Reading density"
        note={
          <Prose className="text-sm">
            The same finding, set flat and then with emphasis. Nothing is highlighted or coloured —
            the body simply drops to muted so the load-bearing words rise out of it.
          </Prose>
        }
      >
        <div className="flex flex-col gap-5 py-1">
          <div>
            <p className="text-meta uppercase tracking-[0.14em] text-faint">Flat</p>
            <p className="mt-1.5 max-w-prose text-base leading-relaxed text-muted">
              Assumption A3 assumes gross margin stays above 70%. That is testable from quarterly
              filings, so breaker B1 watches grossMargin &lt; 70%. It last read 74.98%, leaving 4.98
              points of headroom, next checkable 26 Nov 2026. Assumption A1 carries high load and
              cannot be tested by anything this system can reach.
            </p>
          </div>

          <div>
            <p className="text-meta uppercase tracking-[0.14em] text-faint">With emphasis</p>
            <Prose className="mt-1.5">
              Assumption <Term>A3</Term> assumes <Term>gross margin stays above 70%</Term>. That is
              testable from quarterly filings, so breaker <Term>B1</Term> watches{' '}
              <Metric>grossMargin</Metric> &lt; <Value>70%</Value>. It last read{' '}
              <Value>74.98%</Value>, leaving <Value>4.98</Value> points of headroom, next checkable{' '}
              <Value>26 Nov 2026</Value>. Assumption <Term>A1</Term> carries high load and{' '}
              <Warn>cannot be tested</Warn> by anything this system can reach.
            </Prose>
          </div>
        </div>
      </Section>
    </main>
  );
}
