'use client';

import { useEffect, useState } from 'react';

/**
 * PLACEHOLDER — not the real My Theses screen.
 *
 * `src/app/page.tsx` imports this component, and without the file the whole dev
 * compilation fails, which takes the API routes down with it. This exists so
 * the app builds and the backend is testable while the real screen is written.
 *
 * It is deliberately unstyled. Anything that looked finished would be at risk
 * of being mistaken for the real thing and shipped.
 *
 * Replace wholesale. Nothing here is worth keeping except the shape of the
 * data, which is what `GET /api/thesis` actually returns today.
 */

interface Summary {
  id: string;
  ticker: string;
  direction: string;
  status: string;
  health: string;
  statement: string;
  version: number;
  assumptionCount: number;
  broken: number;
  weakening: number;
  uncheckable: number;
  lastCheckedAt: string | null;
  checkCount: number;
}

interface StoreStatus {
  kind: string;
  persisted: boolean;
  detail: string;
}

function ago(iso: string | null): string {
  if (!iso) return 'never checked';
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(minutes)) return 'never checked';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Home({ startOpen }: { startOpen?: boolean }) {
  const [theses, setTheses] = useState<Summary[] | null>(null);
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/thesis')
      .then((r) => r.json())
      .then((d: { theses?: Summary[]; store?: StoreStatus; error?: string }) => {
        if (d.error) setError(d.error);
        setTheses(d.theses ?? []);
        setStore(d.store ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

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
        PLACEHOLDER SCREEN — the real My Theses view is not built yet. This exists so the app
        compiles and the API is reachable.
        {startOpen ? ' (?new=1 was passed)' : ''}
      </p>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>My Theses</h1>

      {store ? (
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 20 }}>
          store: {store.kind} · {store.persisted ? 'persisted' : 'NOT PERSISTED'} — {store.detail}
        </p>
      ) : null}

      {error ? <p style={{ color: '#c00' }}>{error}</p> : null}
      {theses === null && !error ? <p>Loading…</p> : null}
      {theses !== null && theses.length === 0 ? <p>No theses yet.</p> : null}

      {theses?.map((t) => (
        <div key={t.id} style={{ borderTop: '1px solid #444', padding: '14px 0' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <strong>{t.ticker}</strong>
            <span style={{ opacity: 0.7, fontSize: 13 }}>{t.direction}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}>{t.health.toUpperCase()}</span>
          </div>
          <p style={{ fontSize: 14, opacity: 0.85, margin: '6px 0' }}>{t.statement}</p>
          <p style={{ fontSize: 12, opacity: 0.65 }}>
            v{t.version} · {t.assumptionCount} assumptions · {t.broken} broken · {t.weakening}{' '}
            weakening · {t.uncheckable} uncheckable · {t.checkCount} checks · last{' '}
            {ago(t.lastCheckedAt)}
          </p>
        </div>
      ))}
    </main>
  );
}
