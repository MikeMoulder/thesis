/**
 * The half of the product that happens while nobody is watching.
 *
 * The cron has re-checked every thesis every fifteen minutes since the 16th.
 * Until now, a tripwire firing at 3am waited for somebody to open a browser,
 * which means "fourteen days of notice" was notice nobody received. This is
 * where the loop finally reaches a person.
 *
 * FOUR RULES, AND THE THIRD ONE IS THE PRODUCT
 *
 * 1. ONE MESSAGE PER THESIS, NEVER ONE PER ASSUMPTION. Three assumptions on
 *    NVDA can break in the same check. Three pushes thirty seconds apart is
 *    how a user mutes a bot, and a muted channel is worse than no channel.
 *
 * 2. ONLY ON CHANGE. The recheck already computes transitions against the
 *    previous check, so a quiet tick sends nothing. A heartbeat saying
 *    "nothing happened" four times an hour trains people to ignore the one
 *    message that matters.
 *
 * 3. NEVER ON `uncheckable`. This is the uncomfortable one, because the
 *    product's own type comments call an untestable assumption the most
 *    dangerous kind. But a provider blip flips healthy to uncheckable and
 *    back on the next tick, and from here that is indistinguishable from a
 *    real, permanent loss of testability. Being wrong in the spammy
 *    direction destroys the channel, and a channel nobody reads delivers
 *    nothing at all. The desk still shows uncheckable in full.
 *
 * 4. THE NUMBER TRAVELS WITH THE VERDICT. "An assumption broke" is an
 *    alarm. "Gross margin 65.00% crossed 70.00%, SEC 0001045810-26-000075"
 *    is something a person can act on at 3am without opening a laptop.
 */
import { formatValue } from '../engine/breakers/evaluate';
import { metricPhrase } from '../lib/glossary';
import type { RecheckReport } from '../thesis/recheck';
import { HEALTH_RANK, type Health } from '../thesis/types';
import type { Binding, BindingStore } from './bindings';
import { esc, sendMessage } from './client';
import { MAX_FAILURES } from './bindings';

export type Change = RecheckReport['changes'][number];

/**
 * Worth waking someone for.
 *
 * Both sides must be testable. See rule 3 for why `uncheckable` is excluded
 * despite being the state the product cares most about on screen.
 */
export function worthTelling(change: Change): boolean {
  if (change.from === 'uncheckable' || change.to === 'uncheckable') return false;
  return change.from !== change.to;
}

/** Worsening or recovering, for the headline. */
function direction(change: Change): 'worse' | 'better' {
  return HEALTH_RANK[change.to] > HEALTH_RANK[change.from] ? 'worse' : 'better';
}

function verdict(change: Change): string {
  if (change.to === 'broken') return 'BROKEN';
  if (change.to === 'healthy') return 'RECOVERED';
  return direction(change) === 'worse' ? 'WEAKENING' : 'RECOVERING';
}

/**
 * How the reading sits against its line.
 *
 * Only `broken` means the threshold was actually crossed. `weakening` means
 * the metric is closer to the line than it was and has NOT reached it, so
 * saying "crossed" there states a fact that did not happen: a drawdown of
 * -27.4% against a -30% line is holding, not fired. The first draft of this
 * keyed the verb off the direction of travel and printed
 * "drawdown -27.40% crossed -30.00%", which is a sentence a user would act on
 * and it was false.
 */
function verb(change: Change): string {
  if (change.to === 'broken') return 'crossed';
  if (direction(change) === 'better') return 'back inside';
  return 'closing on';
}

/**
 * One marker for the whole message, picked by the worst thing in it.
 *
 * The rest of this product writes words rather than symbols, and that is the
 * right call on a screen someone is already looking at. A Telegram
 * notification sits in a list of forty chats, where a single glyph is what
 * tells you whether to open it now or after dinner. It is functional here,
 * not decoration, so there is exactly one and it carries severity.
 */
function marker(worst: Health): string {
  if (worst === 'broken') return '\u{1F534}';
  if (worst === 'weakening') return '\u{1F7E1}';
  return '\u{1F7E2}';
}

/**
 * "17 Sep 14:00 UTC". Short enough to sit under a headline on a phone.
 *
 * The month names are written out rather than taken from toLocaleString.
 * Node's ICU build decides that one: the same call returns "Sep" on some
 * runtimes and "Sept" on others, so the message would read differently on a
 * laptop and on the deployment. Caught by the self-test, which is the only
 * place that difference was ever going to be visible.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * The reading that moved, and the line it crossed.
 *
 * Returns null rather than a placeholder when the change carries no numbers.
 * An event breaker has no metric, and printing "undefined crossed undefined"
 * to explain why a belief broke is worse than saying nothing.
 */
function reading(change: Change): string | null {
  if (!change.metric || change.observed === undefined || change.threshold === undefined) {
    return null;
  }
  const observed = formatValue(change.metric, change.observed);
  const threshold = formatValue(change.metric, change.threshold);
  // metricPhrase, not the raw identifier. "grossMargin" is a property name,
  // and camel case in the middle of a sentence tells a reader they have
  // wandered into somebody else's debug output. The desk already does this.
  return `${esc(metricPhrase(change.metric))} ${esc(observed)} ${verb(change)} ${esc(threshold)}`;
}

/** Truncate on a word boundary. A statement can run to several hundred chars. */
function clip(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}...`;
}

export interface ThesisAlert {
  thesisId: string;
  ticker: string;
  changes: Change[];
  html: string;
}

/**
 * Group a report's changes into one alert per thesis.
 *
 * Order matters twice. Theses with a broken assumption come first, because a
 * user reading a stack of notifications reads the top one. Within a thesis,
 * the worst change leads for the same reason.
 */
export function buildAlerts(report: RecheckReport, baseUrl?: string): ThesisAlert[] {
  const relevant = report.changes.filter(worthTelling);
  if (relevant.length === 0) return [];

  const byThesis = new Map<string, Change[]>();
  for (const change of relevant) {
    const list = byThesis.get(change.thesisId);
    if (list) list.push(change);
    else byThesis.set(change.thesisId, [change]);
  }

  const alerts: ThesisAlert[] = [];

  for (const [thesisId, changes] of byThesis) {
    changes.sort((a, b) => HEALTH_RANK[b.to] - HEALTH_RANK[a.to]);
    const first = changes[0]!;
    const worst = changes.reduce<Health>(
      (w, c) => (HEALTH_RANK[c.to] > HEALTH_RANK[w] ? c.to : w),
      'healthy',
    );

    /*
      The headline counts every state in the message, not just the worst one.
      The first draft printed "1 assumption broken" above a message that also
      carried a weakening row, so the headline and the body disagreed about
      how much had happened. A reader trusts the headline and stops there.
    */
    const count = (health: Health) => changes.filter((c) => c.to === health).length;
    const headline = (
      [
        [count('broken'), 'broken'],
        [count('weakening'), 'weakening'],
        [count('healthy'), 'recovered'],
      ] as const
    )
      .filter(([n]) => n > 0)
      .map(([n, word]) => `${n} ${word}`)
      .join(', ');

    const lines: string[] = [
      `${marker(worst)} <b>${esc(first.ticker)}</b>  ${esc(headline)}`,
      '',
    ];

    for (const change of changes) {
      lines.push(`<i>"${esc(clip(change.statement))}"</i>`);
      lines.push(`<b>${verdict(change)}</b>, was ${esc(change.from)}`);

      const read = reading(change);
      if (read) lines.push(read);

      // The source travels with the number. A verdict a user cannot trace
      // back to a filing is an opinion, and this product does not send those.
      if (change.provenance?.source) lines.push(`<i>${esc(change.provenance.source)}</i>`);
      lines.push('');
    }

    lines.push(`Checked ${esc(stamp(first.at))}.`);
    if (baseUrl) lines.push(`${esc(baseUrl.replace(/\/$/, ''))}/thesis/${esc(thesisId)}`);

    alerts.push({ thesisId, ticker: first.ticker, changes, html: lines.join('\n') });
  }

  // Broken first. See the note above about which notification gets read.
  alerts.sort((a, b) => {
    const rank = (list: Change[]) => Math.max(...list.map((c) => HEALTH_RANK[c.to]));
    return rank(b.changes) - rank(a.changes);
  });

  return alerts;
}

export interface DeliveryReport {
  /** Alerts built, before any fan-out. Zero on a quiet tick. */
  alerts: number;
  /** Chats that were eligible: bound and not muted. */
  recipients: number;
  sent: number;
  failed: number;
  /** Bindings dropped after repeated fatal failures. */
  dropped: number;
  /** Chats skipped because the user paused alerts. */
  muted: number;
}

/**
 * Fan the alerts out to every bound chat.
 *
 * Never throws. This runs inside the recheck, and the recheck is the product:
 * a Telegram outage must cost the user their notification, not their check.
 */
export async function deliverAlerts(
  report: RecheckReport,
  bindings: BindingStore,
  baseUrl?: string,
): Promise<DeliveryReport> {
  const alerts = buildAlerts(report, baseUrl);
  const result: DeliveryReport = {
    alerts: alerts.length,
    recipients: 0,
    sent: 0,
    failed: 0,
    dropped: 0,
    muted: 0,
  };

  if (alerts.length === 0) return result;

  let all: Binding[];
  try {
    all = await bindings.list();
  } catch {
    // No delivery list means no delivery. The check itself already happened.
    return result;
  }

  for (const binding of all) {
    if (binding.muted) {
      result.muted += 1;
      continue;
    }
    result.recipients += 1;

    let delivered = 0;
    let fatal = false;

    for (const alert of alerts) {
      const sent = await sendMessage(binding.chatId, alert.html);
      if (sent.ok) {
        delivered += 1;
        result.sent += 1;
      } else {
        result.failed += 1;
        if (sent.fatal) {
          // 403 is the user having blocked the bot. Stop trying to send them
          // the rest of this batch; the remaining alerts would all fail too.
          fatal = true;
          break;
        }
      }
    }

    try {
      if (fatal) {
        const failures = binding.failures + 1;
        if (failures >= MAX_FAILURES) {
          await bindings.remove(binding.chatId);
          result.dropped += 1;
        } else {
          await bindings.put({ ...binding, failures });
        }
      } else if (delivered > 0) {
        await bindings.put({
          ...binding,
          // Any success clears the count. A run of transient failures should
          // not accumulate into a drop.
          failures: 0,
          notified: binding.notified + delivered,
          lastNotifiedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Bookkeeping failed. The message was still delivered, and losing the
      // counter is not worth failing a recheck over.
    }
  }

  return result;
}
