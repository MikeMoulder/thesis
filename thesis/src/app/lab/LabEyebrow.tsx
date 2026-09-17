/**
 * The label every lab page wears, including the part that matters.
 *
 * The lab is a workshop surface for judging components in realistic context.
 * Its numbers are fixed examples that mirror the shape of a real run. They are
 * never engine output, and no product page ever imports them.
 *
 * ## Why this is a component rather than a sentence in each file
 *
 * Because /lab is reachable by anyone who has the deployment URL, and the
 * pages look exactly like the product. Somebody could land on one, read a
 * gross margin, and carry a made-up number away believing a real system
 * produced it. Every page said "Component lab" already, which describes the
 * workshop and says nothing at all about the data.
 *
 * Saying it once, in one place, means it cannot fall off one page during an
 * edit. It sits above the heading rather than below the charts on purpose: a
 * disclosure a reader meets after the number has already done its work is
 * decoration.
 */
export function LabEyebrow() {
  return (
    <>
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Component lab</p>
      <p className="text-meta uppercase tracking-[0.12em] text-trust">
        Fixed example data, not live engine output
      </p>
    </>
  );
}
