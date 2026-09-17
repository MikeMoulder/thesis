import { getStore } from '@/thesis/store';
import type { ThesisStatus } from '@/thesis/types';

/**
 * One thesis: read it, retire it, or delete it.
 *
 * PATCH deliberately only accepts `status`. The thesis TEXT is never editable
 * in place — changing what you believed after the evidence arrived is exactly
 * the behaviour this product exists to prevent, so a new belief goes through
 * `reviseThesis` and becomes version 2 with the old one left standing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  try {
    const thesis = await getStore().get(id);
    if (!thesis) return fail('No thesis with that id.', 404);
    return Response.json({ thesis });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 503);
  }
}

const SETTABLE: ThesisStatus[] = ['live', 'broken', 'retired'];

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;

  let body: { status?: unknown };
  try {
    body = (await request.json()) as { status?: unknown };
  } catch {
    return fail('Body must be JSON.', 400);
  }

  const status = body.status;
  if (typeof status !== 'string' || !SETTABLE.includes(status as ThesisStatus)) {
    return fail(`status must be one of: ${SETTABLE.join(', ')}.`, 400);
  }

  try {
    const store = getStore();
    const thesis = await store.get(id);
    if (!thesis) return fail('No thesis with that id.', 404);

    const updated = { ...thesis, status: status as ThesisStatus };
    await store.put(updated);
    return Response.json({ thesis: updated });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 503);
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  try {
    await getStore().remove(id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 503);
  }
}
