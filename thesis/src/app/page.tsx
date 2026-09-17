import { Desk } from '@/components/shell/Desk';
import { getStore } from '@/thesis/store';
import { summariseThesis, type ThesisSummary } from '@/thesis/types';

export const runtime = 'nodejs'; // the Redis adapter needs Node
export const dynamic = 'force-dynamic';

/**
 * The front door: the research desk, now opening on the theses you already hold.
 *
 * The shell stays. This route was once pointed at an unstyled placeholder and
 * orphaned six sessions of front-end work, so the rule learned then is followed
 * here: a new screen taking this slot CARRIES THE SHELL ACROSS rather than
 * replacing it. The sidebar, watchlist and composer are all still present; what
 * changed is what fills the middle when no analysis is open.
 *
 * Theses are read on the SERVER and passed down. The list of beliefs you are on
 * the hook for is the one screen that must not appear empty and then fill in:
 * for the half second that takes, it reads exactly like having no theses at all,
 * which is the opposite of the product's entire claim.
 */

async function loadTheses(): Promise<ThesisSummary[]> {
  try {
    const theses = await getStore().list();
    return theses.map(summariseThesis);
  } catch {
    // A store outage must not take down the front door. The composer still
    // works, so a user can still start a thesis; they simply cannot see the
    // ones they already have. Better than an error page over the whole app.
    return [];
  }
}

export default async function Page() {
  const theses = await loadTheses();
  return <Desk theses={theses} now={Date.now()} />;
}
