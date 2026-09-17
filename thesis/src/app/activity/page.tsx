import type { Metadata } from 'next';

import { Activity } from '@/components/activity/Activity';
import { buildActivityFeed, summariseActivity } from '@/thesis/activity';
import { getStore } from '@/thesis/store';

/**
 * The activity feed.
 *
 * Server-rendered from the store, like every other screen that reads a thesis.
 * There is deliberately no `/api/activity`: the feed is a pure reading of the
 * check logs this process can already reach, so an API route would be a round
 * trip to ourselves, and a second place for the same derivation to live.
 *
 * `force-dynamic` because the whole point is that it shows what the loop found
 * most recently. A cached copy would be a page that lies about when it looked.
 */

export const runtime = 'nodejs'; // the Redis adapter needs Node
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Activity — THESIS',
  description: 'Every time a belief changed state, across every thesis.',
};

/** How many changes to render. Far more than any demo will produce. */
const FEED_LIMIT = 200;

export default async function Page() {
  // A store outage must not take the page down. An empty feed with the standing
  // explanation is a worse answer than the truth but a better one than a stack
  // trace, and the header still says what this screen is for.
  const theses = await getStore()
    .list()
    .catch(() => []);

  const entries = buildActivityFeed(theses, FEED_LIMIT);
  return <Activity entries={entries} summary={summariseActivity(entries)} now={Date.now()} />;
}
