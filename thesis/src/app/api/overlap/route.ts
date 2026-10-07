import { cachedOverlap } from '@/engine/overlap';
import { ownerFromRequest } from '@/lib/identity';
import { visibleTo } from '@/thesis/ownership';
import { getStore } from '@/thesis/store';

/**
 * What a visitor's theses have in common with each other.
 *
 * Their own theses once they have two to compare. Until then, the public
 * examples, labelled as such, so a first visit still shows what the view is
 * for. Never a mix: an overlap between your thesis and an example is a claim
 * about a portfolio nobody holds.
 *
 * GET only, and cached by the set of thesis versions, so the front page can
 * ask on every load and a model is called only when a thesis is added or
 * revised. See engine/overlap.ts for why the grouping is a model's job and the
 * checking is code's.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const { mine, examples } = visibleTo(await getStore().list(), await ownerFromRequest(request));
    const scope = mine.length >= 2 ? 'yours' : 'examples';
    const result = await cachedOverlap(scope === 'yours' ? mine : examples);
    return Response.json({ ...result, scope });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
