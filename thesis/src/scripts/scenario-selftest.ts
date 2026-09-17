/**
 * Self-test for scenario parsing.
 *
 *   npm run scenario:selftest
 *
 * No model, no network. This parser decides whether a follow-up is answered for
 * free by the evaluator or sent to a model, so a wrong answer here is a
 * misroute in front of a judge.
 */
import { parseScenario } from '../engine/scenario-parse';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function main(): void {
  console.log('\n-- recognises a scenario ---------------------------------------');
  {
    const p = parseScenario('what if gross margin falls to 62%?');
    check('parses gross margin', p?.scenario.grossMargin === 62, JSON.stringify(p?.scenario));
    check('reports what it matched', p?.matched.join() === 'grossMargin');
  }
  {
    const p = parseScenario('what if gross margin drops to 62% and revenue growth falls to 15%?');
    check(
      'parses two metrics in one sentence',
      p?.scenario.grossMargin === 62 && p?.scenario.revenueGrowthYoY === 15,
      JSON.stringify(p?.scenario),
    );
  }
  {
    const p = parseScenario('operating margin at 40, net margin 30');
    check(
      'parses without question phrasing',
      p?.scenario.operatingMargin === 40 && p?.scenario.netMargin === 30,
      JSON.stringify(p?.scenario),
    );
  }

  console.log('\n-- a phrase is consumed once ----------------------------------');
  {
    // "revenue growth" contains "revenue". The general pattern must not re-claim
    // those characters and assert a revenue figure the user never gave.
    const p = parseScenario('what if revenue growth falls to 20% and volatility reaches 75%?');
    check('revenueGrowthYoY parsed', p?.scenario.revenueGrowthYoY === 20, JSON.stringify(p?.scenario));
    check('volatility90d parsed', p?.scenario.volatility90d === 75);
    check(
      'no phantom revenue figure',
      p?.scenario.revenue === undefined,
      `got revenue=${String(p?.scenario.revenue)}`,
    );
    check('matched exactly two metrics', p?.matched.length === 2, JSON.stringify(p?.matched));
  }

  console.log('\n-- numbers that are not the metric ----------------------------');
  {
    const p = parseScenario('what if gross margin falls to 62% over the next 2 quarters?');
    check('does not bind the horizon to the metric', p?.scenario.grossMargin === 62, JSON.stringify(p?.scenario));
  }

  console.log('\n-- drawdown sign convention -----------------------------------');
  {
    const p = parseScenario('what if we see a drawdown of 30%?');
    check(
      'a 30% drawdown is -30, never +30',
      p?.scenario.drawdownFromHigh === -30,
      JSON.stringify(p?.scenario),
    );
  }
  {
    const p = parseScenario('what if drawdown reaches -25%?');
    check('an explicit negative is left alone', p?.scenario.drawdownFromHigh === -25);
  }

  console.log('\n-- refuses to guess ------------------------------------------');
  for (const message of [
    'why can you not test A2?',
    'what would make me wrong?',
    'is this a good trade?',
    'what if the Fed holds rates?',
    'tell me about gross margin',
  ]) {
    check(`no scenario from "${message}"`, parseScenario(message) === null);
  }

  console.log('\n-- a metric with no number is not a scenario ------------------');
  {
    check('bare metric mention', parseScenario('what about operating margin?') === null);
  }

  console.log('\n-- unknown metrics are never invented -------------------------');
  {
    const p = parseScenario('what if market share falls to 60%?');
    check('market share is not in the vocabulary', p === null, JSON.stringify(p?.scenario));
  }

  console.log('\n' + '-'.repeat(66));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main();
