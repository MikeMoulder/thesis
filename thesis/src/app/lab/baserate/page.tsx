import { LabEyebrow } from '@/app/lab/LabEyebrow';
import { BaseRateChart } from '@/components/thesis/BaseRateChart';
import { Code, Prose, Term, Value } from '@/components/prose/emphasis';
import type { HistoricalEvidence } from '@/engine/breakers/evaluate';
import type { ThesisBreaker } from '@/engine/breakers/types';
import history from '@/lib/fixtures/history.json';

/**
 * Real snapshotted engine output — `npm run snapshot:history`. Frozen so the
 * chart can be iterated on without re-reading ten years of filings, but every
 * number came from SEC and Yahoo.
 */
const EVIDENCE = history as unknown as Record<string, HistoricalEvidence>;

const B1: ThesisBreaker = {
  id: 'B1',
  kind: 'threshold',
  assumptionRef: 'A3',
  statement: 'Gross margin falls below 70%.',
  metric: 'grossMargin',
  operator: '<',
  threshold: 70,
  severity: 'high',
  severityInherited: true,
  cadence: 'periodic',
};

const B3: ThesisBreaker = {
  id: 'B3',
  kind: 'threshold',
  assumptionRef: 'A5',
  statement: 'The underlying falls 20% or more from its trailing high.',
  metric: 'drawdownFromHigh',
  operator: '<=',
  threshold: -20,
  severity: 'medium',
  severityInherited: true,
  cadence: 'continuous',
};

export default function BaseRateLabPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <LabEyebrow />
      <h1 className="mt-1 text-xl font-medium">Base rates</h1>
      <Prose className="mt-2 text-sm">
        <Value>26</Value> prior occurrences sounds like a warning.{' '}
        <Term>Seeing the threshold sit in the middle of ten years of normal readings</Term> shows it
        was never unusual. The picture is the argument, which is why a count alone will not do.
      </Prose>

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span data-figure className="text-sm text-muted">
            B1
          </span>
          <Code>grossMargin &lt; 70%</Code>
        </div>
        <p className="mt-1.5 max-w-prose text-base text-muted">{B1.statement}</p>
        <div className="mt-5">
          {EVIDENCE.B1 ? <BaseRateChart evidence={EVIDENCE.B1} breaker={B1} /> : null}
        </div>
      </section>

      <section className="mt-16 border-t border-line pt-10">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span data-figure className="text-sm text-muted">
            B3
          </span>
          <Code>drawdownFromHigh &lt;= -20%</Code>
        </div>
        <p className="mt-1.5 max-w-prose text-base text-muted">{B3.statement}</p>
        <Prose className="mt-2 text-sm">
          A price metric rather than a fundamental one &mdash; <Value>1255</Value> daily bars
          downsampled to ~<Value>314</Value> charted points. Occurrence detection still ran over
          every bar; <Term>downsampling the picture never downsamples the evidence</Term>.
        </Prose>
        <div className="mt-5">
          {EVIDENCE.B3 ? <BaseRateChart evidence={EVIDENCE.B3} breaker={B3} /> : null}
        </div>
      </section>
    </main>
  );
}
