import { Desk } from '@/components/shell/Desk';

export const dynamic = 'force-dynamic';

/**
 * The front door is the RESEARCH DESK, and it stays that way.
 *
 * This route was briefly pointed at `@/components/home/Home`, a deliberately
 * unstyled placeholder written so the app would still compile while the "My
 * Theses" screen was being designed. Its own header says PLACEHOLDER and
 * "replace wholesale". It should never have been what `/` serves, and it is not
 * what production has ever served.
 *
 * If a future screen is meant to take this slot, it replaces Desk here on
 * purpose, with the shell (sidebar, watchlist, composer) carried across rather
 * than dropped. Do not point `/` at a scaffold again.
 */
export default function Page() {
  return <Desk />;
}
