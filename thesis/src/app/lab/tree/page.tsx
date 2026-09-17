import { AssumptionTree } from '@/components/thesis/AssumptionTree';
import { Prose, Term, Value } from '@/components/prose/emphasis';
import { NVDA_BREAKERS, NVDA_DECOMPOSITION } from '@/lib/fixtures/nvda';

export default function TreeLabPage() {
  const { summary, thesis } = NVDA_DECOMPOSITION;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Component lab</p>
      <h1 className="mt-1 text-xl font-medium">Assumption tree</h1>
      <Prose className="mt-2 text-sm">
        The product&rsquo;s argument, made before anyone reads a word. Amber nodes are dead ends —{' '}
        <Term>two of these five branches lead nowhere</Term>, and they are the two the thesis leans
        on hardest.
      </Prose>

      <section className="mt-10">
        <p className="text-meta uppercase tracking-[0.14em] text-faint">The thesis</p>
        <p className="mt-1.5 max-w-prose text-base text-muted">&ldquo;{thesis}&rdquo;</p>

        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted">
          <Value>{summary.claimCount}</Value> claim
          <span className="text-line-strong">·</span>
          <Value>{summary.assumptionCount}</Value> assumptions
          <span className="text-line-strong">·</span>
          <Value>{summary.implicitCount}</Value> you did not state
          <span className="text-line-strong">·</span>
          <Value>{summary.verifiableCount}</Value> externally verifiable
        </p>
      </section>

      <div className="mt-8">
        <AssumptionTree decomposition={NVDA_DECOMPOSITION} breakerSet={NVDA_BREAKERS} />
      </div>

      <section className="mt-12 border-t border-line pt-6">
        <p className="text-meta uppercase tracking-[0.14em] text-faint">
          Before tripwires are generated
        </p>
        <Prose className="mt-1.5 text-sm">
          The tree renders as soon as decomposition finishes, so it appears while the breaker pass is
          still running. Testable assumptions say so and wait, rather than showing an empty branch
          that looks like a dead end.
        </Prose>
        <div className="mt-6">
          <AssumptionTree decomposition={NVDA_DECOMPOSITION} breakersPending />
        </div>
      </section>
    </main>
  );
}
