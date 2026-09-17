import { Sidebar } from '@/components/shell/Sidebar';
import { cn } from '@/lib/utils';

/**
 * The shell, around a page that is not the Desk.
 *
 * `/` renders a Desk, which owns chat sessions and therefore owns the sidebar's
 * state. Every other screen has no such state and used to render bare, so
 * clicking from the thesis list into a thesis made the sidebar, the watchlist
 * and the source health all disappear. The app read as two different products
 * either side of one link.
 *
 * The sidebar is self-sufficient now, so this is thin on purpose: a flex row, a
 * sidebar with no props, and a scrolling main. Anything cleverer would be a
 * second layout to keep in step with the first.
 *
 * Hidden below the `md` breakpoint, matching the Desk. A 240px rail on a phone
 * takes two thirds of the screen away from the thing the reader came for.
 */
export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-dvh overflow-hidden', className)}>
      <Sidebar className="hidden md:flex" />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
