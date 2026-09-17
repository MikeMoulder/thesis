import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ThesisDetail } from '@/components/thesis/ThesisDetail';
import { getStore } from '@/thesis/store';
import { currentVersion, latestCheck, type ThesisRecord } from '@/thesis/types';

/**
 * One thesis, under observation.
 *
 * SERVER-RENDERED, reading the store directly rather than fetching its own API.
 * This is the page a judge opens from a link, and a spinner must not be the
 * first thing on it. Going through `/api/thesis/[id]` would mean a round trip
 * to our own server to fetch data this process can already reach — a loading
 * flash bought with an extra network hop.
 *
 * `force-dynamic` because the whole claim of the page is that it shows what the
 * loop found MOST RECENTLY. A cached copy of this page is a page that lies
 * about when it last looked, which is the one thing it cannot do.
 */

export const runtime = 'nodejs'; // the Redis adapter and the fs-backed counter need Node
export const dynamic = 'force-dynamic';

async function load(id: string): Promise<ThesisRecord | null> {
  try {
    return await getStore().get(id);
  } catch {
    // A store outage is not a missing thesis. Returning null would render a
    // 404 saying this belief does not exist, when in fact we simply could not
    // reach it — so let it throw to the error boundary instead.
    throw new Error('The thesis store could not be reached.');
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const thesis = await load(id).catch(() => null);
  if (!thesis) return { title: 'Thesis not found — THESIS' };

  const version = currentVersion(thesis);
  const check = latestCheck(thesis);
  return {
    title: `${thesis.ticker} — ${check?.health ?? 'unchecked'} — THESIS`,
    description: version.statement.slice(0, 180),
  };
}

export default async function ThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thesis = await load(id);
  if (!thesis) notFound();

  return <ThesisDetail thesis={thesis} />;
}
