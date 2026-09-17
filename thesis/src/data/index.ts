import { DATA_SOURCE_MODE } from './config';
import type { DataSource } from './DataSource';
import { DirectDataSource } from './DirectDataSource';
import { SignalDataSource } from './SignalDataSource';

export * from './types';
export type { DataSource, DerivedMetricName, HealthReport, HistoryPeriod } from './DataSource';
export { DirectDataSource } from './DirectDataSource';
export { SignalDataSource } from './SignalDataSource';
export { resolveInstrument } from './registry';

let singleton: DataSource | null = null;

/**
 * The only way the rest of the app should obtain data.
 *
 * Mode comes from THESIS_DATA_SOURCE and defaults to 'direct'. Nothing above
 * this line knows which providers are in play, which is what lets the
 * bitget-signal integration be switched on later without edits elsewhere.
 */
export function getDataSource(mode = DATA_SOURCE_MODE): DataSource {
  if (singleton && singleton.name === mode) return singleton;
  singleton = mode === 'signal' ? new SignalDataSource() : new DirectDataSource();
  return singleton;
}

/** Test seam. */
export function __setDataSource(ds: DataSource | null): void {
  singleton = ds;
}
