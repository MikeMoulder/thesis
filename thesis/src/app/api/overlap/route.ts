import { cachedOverlap } from '@/engine/overlap';
import { getStore } from '@/thesis/store';

/**
 * What every stored thesis has in common with the others.
 *
 * GET only, and cached by the set of thesis versions, so the front page can
 * ask on every load and a model is called only when a thesis is added or
 * revised. See engine/overlap.ts for why the grouping is a model's job and the
 * checking is code's.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  try {
    const theses = await getStore().list();
    return Response.json(await cachedOverlap(theses));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
