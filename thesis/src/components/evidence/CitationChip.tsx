import { ExternalLink } from 'lucide-react';

import type { Provenance } from '@/data/types';
import { cn } from '@/lib/utils';

import { SourceMark } from './SourceMark';
import { TRUST_ICON, describeSource, formatAsOf, type SourceKind } from './source-kind';

/**
 * The citation that hangs off a number.
 *
 * Every figure in THESIS carries one. This is the component the whole evidence
 * promise rests on, so three rules are deliberate and worth not "improving":
 *
 * 1. NO CHROME. No border, no fill, no pill. A citation sits beside a figure
 *    dozens of times on a page; boxed, the page becomes a wall of containers
 *    and the figures stop being the thing you read.
 *
 * 2. AMBER MEANS EXACTLY ONE THING — "you are carrying this on trust", which
 *    is `unverifiable` and nothing else. `inferred` is weaker than `sourced`
 *    but it is still evidence, so it stays monochrome and says what it is with
 *    an icon instead. If amber also meant "derived" it would appear on most
 *    rows and stop being a warning.
 *
 * 3. IT IS A LINK WHEN, AND ONLY WHEN, ONE EXISTS. A citation you cannot open
 *    is not a citation. Where there is no document, the chip must not look
 *    clickable.
 */

export interface CitationChipProps {
  provenance: Provenance;
  /** Override the inferred kind when the caller knows better than the string. */
  kind?: SourceKind;
  /** Render the derivation on a second line. Off by default — the chip is quiet. */
  showDerivation?: boolean;
  className?: string;
}

export function CitationChip({
  provenance,
  kind,
  showDerivation = false,
  className,
}: CitationChipProps) {
  const described = describeSource(provenance);
  const resolvedKind = kind ?? described.kind;

  const TrustIcon = TRUST_ICON[provenance.status];

  const asOf = formatAsOf(provenance.asOf);
  const onTrust = provenance.status === 'unverifiable';
  const href = provenance.url;

  // The full source string is often long ("SEC 10-Q 0001045810-26-000075").
  // The chip shows a short label; the whole thing stays available on hover.
  const fullTitle = [provenance.source, provenance.derivation].filter(Boolean).join(' — ');

  const body = (
    <>
      {/*
        The icons carry the signal, the text carries the detail — so the icons
        sit one step brighter than the label. At 12px in faint grey the
        difference between a shield and a sigma is not readable, which would
        defeat the point of pairing them.
      */}
      <TrustIcon
        size={13}
        strokeWidth={1.5}
        aria-hidden
        className={onTrust ? undefined : 'text-muted'}
      />
      <SourceMark kind={resolvedKind} brand={described.brand} size={13} />
      <span>{described.label}</span>
      {asOf ? (
        <>
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          <span data-num>{asOf}</span>
        </>
      ) : null}
      {href ? <ExternalLink size={11} strokeWidth={1.5} aria-hidden className="opacity-60" /> : null}
    </>
  );

  const shared = cn(
    'inline-flex items-center gap-1 align-baseline text-meta leading-none',
    onTrust ? 'text-trust' : 'text-faint',
    className,
  );

  return (
    <span className={showDerivation ? 'inline-flex flex-col gap-0.5' : 'contents'}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={fullTitle}
          aria-label={`Open source: ${provenance.source}`}
          className={cn(
            shared,
            'underline-offset-[3px] transition-colors hover:text-text hover:underline',
          )}
        >
          {body}
        </a>
      ) : (
        <span className={shared} title={fullTitle || undefined}>
          {body}
        </span>
      )}

      {showDerivation && provenance.derivation ? (
        <span className="text-meta leading-snug text-faint">{provenance.derivation}</span>
      ) : null}
    </span>
  );
}
