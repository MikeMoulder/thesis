'use client';

/**
 * PLACEHOLDER — not the real Activity feed.
 *
 * `src/app/activity/page.tsx` imports this. Without the file, dev compilation
 * fails and takes the API routes down with it, which is the only reason it
 * exists. Replace it wholesale.
 *
 * The sibling placeholder it used to point at, `components/home/Home.tsx`, has
 * been deleted: the real My Theses screen now stands at `/`.
 *
 * The real feed reads the `changes` that `appendCheck` already records on every
 * check — each one carries the assumption, both ends of the transition, the
 * observed number, the threshold, and its provenance. Nothing new needs
 * computing for it; it is a rendering of the check log.
 */

export function Activity() {
  return (
    <main style={{ padding: 32, fontFamily: 'var(--font-geist-sans), system-ui', maxWidth: 760 }}>
      <p
        style={{
          padding: '8px 12px',
          marginBottom: 24,
          border: '1px dashed #999',
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        PLACEHOLDER SCREEN — the real Activity feed is not built yet. This exists so the app
        compiles and the API is reachable.
      </p>

      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Activity</h1>
      <p style={{ fontSize: 14, opacity: 0.75 }}>
        Every health transition across every thesis, newest first. The data already exists in each
        thesis&rsquo;s check log — this screen is a rendering of it, not a new computation.
      </p>
    </main>
  );
}
