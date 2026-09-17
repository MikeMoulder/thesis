/**
 * Endpoints and knobs for the data layer.
 *
 * NOTE ON NETWORK ACCESS: api.bitget.com is geo-restricted in some regions.
 * It returned connection failures from the dev machine until a VPN was enabled.
 * If Bitget calls fail with a transport error rather than an API error code,
 * check the network before debugging the code.
 */

export const BITGET_BASE = process.env.BITGET_BASE ?? 'https://api.bitget.com';

export const YAHOO_CHART_BASE =
  process.env.YAHOO_CHART_BASE ?? 'https://query1.finance.yahoo.com/v8/finance/chart';

export const SEC_DATA_BASE = 'https://data.sec.gov';
export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

/**
 * SEC requires a descriptive User-Agent with contact details on every request.
 * Requests without one are throttled or blocked outright.
 * @see https://www.sec.gov/os/webmaster-faq#developers
 */
export const USER_AGENT =
  process.env.SEC_USER_AGENT ?? 'THESIS Research Desk (hackathon build) contact@example.com';

/** bitget-signal's public MCP data backend. See SignalDataSource for status. */
export const SIGNAL_MCP_URL =
  process.env.SIGNAL_MCP_URL ?? 'https://datahub.noxiaohao.com/mcp';

/**
 * Which implementation to use. `direct` is the default because the
 * bitget-signal backend was verified non-functional on 2026-09-16 — it
 * answers MCP calls but has no working outbound network, so every tool that
 * needs a real fetch returns an empty error.
 */
export const DATA_SOURCE_MODE =
  (process.env.THESIS_DATA_SOURCE as 'direct' | 'signal' | undefined) ?? 'direct';

/** Default request timeout, milliseconds. */
export const REQUEST_TIMEOUT_MS = Number(process.env.THESIS_TIMEOUT_MS ?? 30_000);
