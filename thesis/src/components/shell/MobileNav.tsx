'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Plus, X } from 'lucide-react';

import { Sidebar } from '@/components/shell/Sidebar';
import { cn } from '@/lib/utils';

/**
 * Navigation below the `md` breakpoint.
 *
 * The sidebar is hidden on phones, because a 272px column takes most of a
 * 390px screen. Until this existed nothing replaced it, so a phone had no
 * menu, no watchlist and no way to a thesis except the back link. Public
 * voting runs on X, where most people open a link on their phone.
 *
 * A bar with the three things a phone needs at once (the menu, the name, a
 * new thesis) and a drawer holding the SAME sidebar the desktop uses, forced
 * open. One component in two containers, so the phone never shows a menu that
 * has drifted from the desktop one.
 *
 * The drawer's sidebar mounts on first open, not with the page. Mounted
 * eagerly it would fetch prices and source health a second time on every
 * desktop page load, for a menu that is never shown there.
 */
// NonNullable: the sidebar's props are optional as a whole, which puts undefined in the type.
type SidebarProps = Omit<NonNullable<ComponentProps<typeof Sidebar>>, 'forceOpen' | 'className'>;

export function MobileNav(props: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const show = () => {
    setMounted(true);
    setOpen(true);
  };
  const close = () => setOpen(false);

  // A link followed from inside the drawer lands on a new page with it shut.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /*
    Handlers the page supplied act in place, on the page underneath, so the
    drawer has to shut itself first. Handlers the sidebar falls back to
    navigate, and the pathname effect above shuts it.
  */
  const thenClose = <A extends unknown[]>(fn: ((...args: A) => void) | undefined) =>
    fn
      ? (...args: A) => {
          close();
          fn(...args);
        }
      : undefined;

  const startNew = () => (props.onNew ? props.onNew() : router.push('/'));

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
        <button
          type="button"
          onClick={show}
          aria-label="Open menu"
          aria-expanded={open}
          className="rounded-[7px] p-2 text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <Menu size={18} strokeWidth={1.5} aria-hidden />
        </button>
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.png" alt="" aria-hidden width={22} height={22} className="size-[22px]" />
          <span className="text-base font-medium tracking-[-0.01em] text-text">THESIS</span>
        </Link>
        <button
          type="button"
          onClick={startNew}
          aria-label="New thesis"
          className="ml-auto rounded-full bg-raised p-2 text-text transition-opacity hover:opacity-80"
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </header>

      <div
        className={cn('fixed inset-0 z-50 md:hidden', open ? '' : 'pointer-events-none')}
        inert={!open}
      >
        <div
          aria-hidden
          onClick={close}
          className={cn(
            'absolute inset-0 bg-black/60 transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={cn(
            'absolute inset-y-0 left-0 flex w-[296px] max-w-[85vw] flex-col bg-ground',
            'transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="absolute right-3 top-3.5 z-10 rounded-[7px] p-1.5 text-faint transition-colors hover:bg-raised hover:text-text"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
          {mounted ? (
            <Sidebar
              {...props}
              forceOpen
              onSelect={thenClose(props.onSelect)}
              onNew={thenClose(props.onNew)}
              onPickTicker={thenClose(props.onPickTicker)}
              className="h-full w-full"
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
