import { getCryptoSessionRisk } from '@/data/providers/signal';
import { usMarketState } from '@/lib/market-hours';

/**
 * Who is pricing this token right now.
 *
 * The only route that reaches a bitget-signal Skill to produce something a
 * user reads, rather than to report on the Skills themselves the way /api/diag
 * does.
 *
 * ## Why the Skill is not called when New York is open
 *
 * Because the answer would not be used. The strip this feeds exists to say
 * something true during the hours when the underlying equity market is shut
 * and the rToken is still trading. While the market is open that sentence is
 * false, so the component renders nothing, and a call whose result is thrown
 * away is a call worth not making. It also keeps the Skill's own rate budget
 * for the hours that need it.
 *
 * ## Why a failure here is a 200
 *
 * Four of the five bitget-signal tools have no working upstream on Bitget's
 * host, and the fifth can join them at any moment. That is a normal condition
 * for this dependency rather than an exception, and the honest rendering of it
 * is an absent strip, not an error. So the route answers "no context
 * available" with a 200 and the component draws nothing.
 *
 * A 500 here would put a red state on a research screen because an optional
 * crypto indicator did not load, which tells the reader their analysis is
 * broken when it is not.
 */

export const runtime = 'nodejs'; // the MCP client needs it
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(): Promise<Response> {
  const market = usMarketState();

  const body: Record<string, unknown> = {
    marketOpen: market.open,
    minutesUntilChange: market.minutesUntilChange,
  };

  if (market.open) {
    return Response.json({ ...body, risk: null, skipped: 'US market is open' });
  }

  try {
    const risk = await getCryptoSessionRisk();
    return Response.json({ ...body, risk });
  } catch (error) {
    return Response.json({
      ...body,
      risk: null,
      skipped: error instanceof Error ? error.message : String(error),
    });
  }
}
