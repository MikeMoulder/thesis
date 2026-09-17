import { KIND_ICON, type SourceBrand, type SourceKind } from './source-kind';

/**
 * The "what produced this" half of a citation's icon pair.
 *
 * Renders the vendor's real logo where we have one, and falls back to a generic
 * category icon where we do not. Two judgements are deliberate:
 *
 * BRAND COLOUR IS KEPT. The rest of the interface is monochrome plus amber, but
 * a desaturated trademark stops being that trademark — grey is not Bitget's
 * mark, it is a grey square. At 13px these read as identity, not as status, so
 * they do not compete with amber. The rule that still holds absolutely: no
 * *text* and no *status* may take a colour other than amber or red.
 *
 * SEC KEEPS THE GENERIC ICON. Their seal is a finely detailed eagle that turns
 * to mud below about 24px, and the informative token in an SEC citation is the
 * form type — "10-Q" — not the agency. A document icon plus "10-Q" says more at
 * this size than a smudged seal would.
 */

const BRAND_SRC: Record<SourceBrand, { src: string; alt: string }> = {
  bitget: { src: '/marks/bitget.png', alt: 'Bitget' },
  yahoo: { src: '/marks/yahoo.png', alt: 'Yahoo Finance' },
};

export function SourceMark({
  kind,
  brand,
  size = 13,
}: {
  kind: SourceKind;
  brand?: SourceBrand | undefined;
  size?: number;
}) {
  if (brand) {
    const { src, alt } = BRAND_SRC[brand];
    return (
      // A plain <img>: these are 13px marks already smaller than any responsive
      // breakpoint, so next/image's machinery would add cost and no benefit.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="inline-block shrink-0 rounded-[2.5px] align-[-0.12em]"
        loading="lazy"
        decoding="async"
      />
    );
  }

  const Icon = KIND_ICON[kind];
  return <Icon size={size} strokeWidth={1.5} aria-hidden className="shrink-0" />;
}
