import { AttackRunner } from '@/components/thesis/AttackRunner';
import { Prose, Term } from '@/components/prose/emphasis';

export const dynamic = 'force-dynamic';

export default function AttackPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Live run</p>
      <h1 className="mt-1 text-xl font-medium">Attack my thesis</h1>
      <Prose className="mb-10 mt-2 text-sm">
        Real engine, real filings, real prices. The assumption tree appears as soon as decomposition
        finishes, then tripwires fill in &mdash; <Term>nothing here is fixture data</Term>.
      </Prose>

      <AttackRunner />
    </main>
  );
}
