# THESIS

**Write down why you are buying something. THESIS takes that sentence apart, finds every belief hiding inside it, puts an exact number under each one, and then watches those numbers around the clock so you learn you were wrong from the data instead of from the price.**

[Open the live desk](https://thesis-mikes-projects-7ac9bd1b.vercel.app) · [A thesis under observation](https://thesis-mikes-projects-7ac9bd1b.vercel.app/thesis/tsla-c5qqql) · [Every check it has ever run](https://thesis-mikes-projects-7ac9bd1b.vercel.app/activity) · [Source health, live](https://thesis-mikes-projects-7ac9bd1b.vercel.app/api/diag)

Built for the **Bitget AI Base Camp Hackathon S2**, on the **Bitget Agent Hub SDK**, **Qwen** through Bitget's hackathon gateway, and the **bitget-signal Skills**.

Track 3, AI Trading Desk. Sub-theme: Decision Stress Testing.

---

## The problem, in one person

You buy something and you write down why. Four weeks later the position is down eighteen percent and you are staring at the chart trying to remember what you actually said. Was this the thing you were worried about, or a different thing? You said you would get out if margins cracked. Did they? You are not going to go and read a quarterly filing at eleven at night, so you do what everyone does. You look at the price and let it tell you how to feel.

Tokenized US stocks make this sharply worse. An rToken trades every hour of every day. The company behind it reports four times a year. So the thing you own moves constantly, while the reasons you bought it barely move at all, and nobody is awake to notice the moment one of those reasons quietly stops being true.

**THESIS is the thing that stays awake.**

---

## What we built

One loop, and it never stops turning.

```text
1. You write a thesis in plain English, the way you would say it to a friend.

2. THESIS pulls it apart into every claim it makes and every assumption
   underneath, INCLUDING the ones you never said out loud.

3. A second model from a different family reads the same thesis and hunts
   for what the first one missed.

4. Every belief that can be measured gets a tripwire: an exact number,
   a source, and a schedule.

5. Every fifteen minutes, forever, those numbers are read from live
   filings and live prices.

6. The moment one moves, Telegram tells you. At 3am. On a Sunday.

7. Later, THESIS grades its own record: what held, what broke, and how
   many days of warning you actually got before it did.
```

Steps 4 through 7 are the part almost nothing else does. Plenty of tools will summarise a stock. This one writes down what would prove you wrong, then holds you to it.

---

## See it working, with numbers that are true right now

This is a real thesis, live on the deployment as you read this. Open it at [/thesis/tsla-c5qqql](https://thesis-mikes-projects-7ac9bd1b.vercel.app/thesis/tsla-c5qqql).

A person typed a paragraph about Tesla. THESIS found **six things that have to be true**, and one of them the author never wrote down. Five got a number attached. Here is where they stand:

| What has to be true | Right now | Breaks at | Room left | Reads from |
|---|---|---|---|---|
| Revenue growth stays at or above 25% | 25.52% | 25.00% | 0.52 points | SEC 10-Q, filed 23 Jul 2026 |
| Gross margin does not fall below 16% | 16.83% | 16.00% | 0.83 points | SEC 10-Q, filed 23 Jul 2026 |
| Operating margin recovers, stays above 0% | 1.41% | 0.00% | 1.41 points | SEC 10-Q, filed 23 Jul 2026 |
| Drawdown does not deepen past 30% | -26.59% | -30.00% | 3.41 points | Live price |
| Volatility does not push above 50% | **57.57%** | 50.00% | **already crossed** | Live price |

And the sixth, the one that matters most:

> "The market has not fully priced in the permanence of lower operating margins or the risk that AI and robotaxi spending will not roll off as anticipated."
>
> The author never said this. Their reasoning does not work without it. **Nothing in this desk can ever check it**, and THESIS says so in exactly those words rather than inventing a number for it.

### The line we are proudest of

That thesis has been checked **150 times** between 22 Jun 2026 and 17 Sep 2026. Ninety of those checks were observed live. Sixty were reconstructed from history, and every single reconstructed row is labelled as reconstructed, because a warning you were never actually given is not a warning.

Out of that log, the product prints one sentence about itself:

> **The first warning came 14 days before anything broke.**
>
> "90-day realised volatility will not push above 50%" weakened on 23 Jun 2026 and broke on 7 Jul 2026.

Fourteen days. Not a backtest, not a promise, a measurement taken from its own record. And on the NVDA thesis next to it, where nothing has broken, it refuses to take a victory lap: *"Nothing has broken yet. That is not the same as nothing being at risk, and it says nothing at all about the parts no tripwire covers."*

**A product that only prints its wins is a brochure. This one prints the misses too, which is the only reason to believe the wins.**

---

## The organisers' stack, and how far we took it

Everything Bitget handed builders, we used. Here is the honest depth of each, with the file you can open to check us.

| What Bitget gave us | What we did with it | Where it lives | How deep |
|---|---|---|---|
| **Bitget Agent Hub SDK** | The entire market side of the product. Token discovery, live 24/7 prices, candles, and the order book that decides how big a position can safely be | [`src/data/providers/bitget.ts`](thesis/src/data/providers/bitget.ts) | **Load-bearing. Remove it and half the product stops existing** |
| **Qwen**, via Bitget's hackathon gateway | A second pair of eyes on every thesis, from a different model family, hunting for assumptions the first model missed | [`src/engine/challenge.ts`](thesis/src/engine/challenge.ts) | **A real job, with a real finding behind it** |
| **bitget-signal Skills** (MCP) | Live probing of all five, plus the one that works put on screen as overnight market context | [`src/data/providers/signal.ts`](thesis/src/data/providers/signal.ts), [`src/components/thesis/SessionContext.tsx`](thesis/src/components/thesis/SessionContext.tsx) | **Used honestly, including about what is broken on their side** |

### Bitget Agent Hub SDK: the spine

We did not call one endpoint to qualify for a prize. The SDK is the only way this product knows what a tokenized stock is worth.

We build the client **read-only, market data only, with no credentials at all**:

```ts
loadConfig({ readOnly: true, modules: 'market', baseUrl: BITGET_BASE, ... })
```

That is not a promise never to trade. It is an **inability** to trade. Every write operation is stripped out at construction. When we say this research desk cannot place an order on your account, that is a fact about the code, not a policy in a document.

Through it we use four operations, resolved by the SDK's own catalogue rather than by hand-written URLs: `getInstruments`, `getTickers`, `getKlineCandlestick` and `getOrderbook`. From those we get the full live catalogue of **1,175 tokenized stocks**, the round-the-clock price, and something most projects never touch.

**The order book is where we went deepest.** Every other source describes the past. A price tells you what the last trade printed at. The book tells you whether anybody will take the other side of your exit right now, and for tokenized stocks that gap is enormous. We measured it:

```text
RNVDAUSDT   217.74    47.1M volume    5 asks / 5 bids
RNFLXUSDT    76.92    12.4M volume    0 asks / 0 bids
RDISUSDT    107.32     3.9M volume    0 asks / 0 bids
```

Of 28 tokens we sampled, **14 had no order book at all**. Netflix quotes a confident price against an empty book. A stop-loss placed there has nothing to fill against. So we turned that into a feature: THESIS reads the real resting depth and uses it to cap how large a position can be before your own exit would walk the price down.

**Two traps in their API that we found the hard way, and handled:**

First, every numeric field arrives as text, including the decimal precisions. A precision of `"4"` quietly becomes a broken number two layers later if you do not convert it at the door. We convert at the door, and where a value is missing we fall back to the *tightest* plausible setting rather than the loosest, because an order that is slightly smaller than you asked gets accepted, and one with too many decimal places gets rejected in front of whoever is watching your demo.

Second, and this one is genuinely dangerous. On Bitget spot, the `qty` field means **number of shares** for a limit order and **number of dollars** for a market buy. Same field, same endpoint, two different meanings chosen by a different field. Send dollars where shares were expected on a 200 dollar stock and the exchange opens a position **200 times too large**. It does not error. It fills. We have **five tests that exist purely to make sure we never do this**, asserting that quantity equals budget divided by price, that quantity is not the dollar amount, and that quantity times price lands back on the budget.

### Qwen: a second reader, and the discovery that made it work

Qwen runs the **second opinion**. After the first model takes a thesis apart, Qwen reads the same thesis independently and looks for load-bearing assumptions that were missed. Anything it finds is merged in and gets its own tripwire, exactly like every other assumption. It is never allowed to edit or overwrite what the first model concluded, only to add, so you can always tell which model said what.

We are precise about the claim this supports: **using a different model family reduces how much the answer depends on one model's habits.** It does not make the two independent. They share training data and they will share blind spots. We say that in the code and we say it here.

**The part worth telling you about.** For most of the build, this seat simply did not work. Every call to the gateway timed out at 45 seconds. It looked like the sponsor's service was unreliable, and it would have been very easy to write that in a README and move on.

It was not their service. We measured it properly, holding everything else fixed:

```text
a trivial prompt                          answered in about 3s     4 of 4
the real prompt, 700 token budget         TIMED OUT at 45s         3 of 3
the real prompt, 2000 token budget        answered in 41.9s        1 of 1
the real prompt, stream mode              answered in 44.2s        1 of 1
the real prompt, hidden thinking OFF      answered in  5.2s        1 of 1
```

`qwen3.8-max` is a **reasoning model**. It thinks silently before it writes anything, and on a genuinely hard question that silent thinking consumed the entire budget before a single word of the answer existed. One setting, `enable_thinking: false`, took it from never answering to answering in about four seconds.

Re-measured ten times in a row through the live code path: **10 of 10 answered, fastest 2.97 seconds, slowest 8.43 seconds.**

You can run this yourself, and watch the old behaviour fail on purpose:

```bash
npm run qwen:check -- 3 --compare
```

That command sends the identical prompt both ways. With the flag it answers in about four seconds. Without it, it burns the full timeout and dies, exactly as our build did for two days.

**A real thing Qwen found**, live on our deployment, on a Tesla thesis that already listed five assumptions:

> "The cheaper model launches and achieves meaningful delivery volume within the 6-month horizon."
>
> Why it was missed: *"Focus stayed on aggregate delivery reacceleration rather than specific product timing."*

That is a genuine load-bearing belief the first model never wrote down, and it now has a tripwire on it.

### bitget-signal Skills: used, and honest about the rest

We connected to the Skills over MCP and we test all five of them live, on every page load of [`/api/diag`](https://thesis-mikes-projects-7ac9bd1b.vercel.app/api/diag). Here is what actually answers, measured repeatedly on 16 and 17 Sep 2026:

```text
technical_analysis     works, real values      474ms
global_assets          no answer within 6s     (their Yahoo upstream)
news_feed              no answer within 6s     (their 44 RSS feeds)
sentiment_index        no answer within 6s     (their alternative.me upstream)
macro_indicators       no answer within 6s     (their FRED upstream)
```

**One of five works.** The server itself is fine, it answers the protocol perfectly. Four of its data sources are unreachable from their host. That is a fact about their infrastructure and not about our code, and rather than hide it we built a live probe that reports it truthfully and would light up the moment they fix it, with no code change from us.

The one that works, we genuinely use, and we found the one moment where it is not decoration.

An rToken trades 24 hours a day. The company behind it does not. **From the closing bell until the next morning, sixteen hours on a weekday and sixty-five hours across a weekend, the only people buying and selling rNVDA are crypto traders.** The price your position is marked against overnight is a price they set. During those hours, their appetite for risk is a real fact about your position rather than a loose analogy.

So on every thesis page, and **only while the US market is shut**, THESIS shows this:

```text
WHILE NEW YORK IS SHUT

rTSLA keeps trading for another 15 hours. Until the bell, the people setting
its price are crypto market participants rather than equity ones, so this is
the risk appetite your position is marked against overnight.

BTC/USDT · 4H · RSI  45.8  NEUTRAL      via technical_analysis, 17 Sep 2026

On a 0 to 100 scale, neither side has had the better of it lately.

Context, not a signal. No tripwire is derived from this, because the
relationship between crypto risk appetite and a tokenized equity is not
something this desk has measured.
```

It vanishes the moment the market opens, because at 11am that sentence would be false. It generates no tripwire. And if the Skill stops answering, the whole panel simply disappears rather than showing a broken box on a research screen.

We also checked whether the Skill could read the rTokens directly, which would have been better. It cannot, and we would rather tell you than let you assume:

```text
RNVDAUSDT    "No OHLCV data"
RNVDA/USDT   "No OHLCV data"
BTC/USDT     rsi 50.3, neutral, 506ms
```

---

## How it works

```text
YOU TYPE A PARAGRAPH
         |
         v
  RESOLVE THE COMPANY ....... src/data/registry.ts
  ticker -> rToken symbol -> SEC filing identity
  (1,175 tokenized stocks, pulled live from Bitget)
         |
         v
  TAKE THE THESIS APART ..... src/engine/decomposer/
  claims, stated assumptions, and the unstated ones
         |
         +--> SECOND OPINION (Qwen) .... src/engine/challenge.ts
         |    runs alongside, never blocks, only ever adds
         v
  WRITE THE TRIPWIRES ....... src/engine/breakers/
  metric, operator, threshold, source, schedule
         |
         v
  READ THE REAL NUMBERS ..... src/engine/breakers/evaluate.ts
  no model calls here at all, just data
         |
    +----+----+----------------+
    |         |                |
    v         v                v
 BITGET    YAHOO            SEC EDGAR
 live       long price      filings and
 24/7       history         fundamentals
 prices                     src/data/providers/edgar.ts
 + order
   book
         |
         v
  EVERY FIFTEEN MINUTES, FOREVER .... src/thesis/recheck.ts
         |
         v
  TELEGRAM, THE MOMENT SOMETHING MOVES .... src/telegram/
         |
         v
  GRADE ITS OWN RECORD ...... src/thesis/autopsy.ts
  what held, what broke, how much warning you really got
```

Every box above is a real folder in this repository.

---

## The parts that were genuinely hard

**Knowing a number and knowing when you could have known it.** To ask "how often has this thesis been in trouble before", you have to value the company as it stood on a past date. The trap is brutal and the result looks completely convincing when you fall in: pair today's share count with a price from three years ago and you invent a company valuation that never existed. Every input we use is selected by **the date it became publicly knowable**, and we skip any day that does not have four filed quarters behind it. Invisible work, and the entire reason those historical numbers can be trusted.

**Telling the difference between a warning and a reconstruction.** Sixty of those 150 checks were rebuilt from history. They are what THESIS *would have* told you. Every one is labelled that way, on every row, not once in a footnote. Taking credit for a warning you never sent is the easiest and most tempting lie in this entire product category.

**A price with nobody behind it.** Half the tokenized stocks we sampled have a confident price and an empty order book. THESIS reads the real depth and sizes positions against it, so "you can get out" is something it checks rather than something it assumes.

**A model that thinks too long to answer.** Covered above. Two days of apparent sponsor flakiness turned out to be one setting, found by measuring instead of guessing.

**Never letting a stale screen imply a fresh check.** The recheck loop, the display, and the stored record all agree on when a number was last actually read. "Last checked 1 minute ago" is the one claim this product can never get wrong.

---

## Test logs

Every suite is hand-written and runs with no network and no model calls, so the numbers below are the same on your machine as on ours.

```text
$ npm test

decompose      43 passed, 0 failed     taking a thesis apart
breakers       24 passed, 0 failed     writing the tripwires
actions        18 passed, 0 failed     what to do next
scenario       18 passed, 0 failed     what-if mode
thesis        132 passed, 0 failed     records, health, the check log
backfill       34 passed, 0 failed     reconstructing history safely
brief          27 passed, 0 failed     the closing summary
valuation      33 passed, 0 failed     knowable-date discipline
liquidity      35 passed, 0 failed     order book depth and exit cost
signal         23 passed, 0 failed     reading the Bitget Skills
stress         26 passed, 0 failed     the preset stress tests
challenge      36 passed, 0 failed     the Qwen second opinion
activity       20 passed, 0 failed     the activity feed
autopsy        22 passed, 0 failed     grading its own record
telegram       74 passed, 0 failed     alerts, binding, webhook security
derive         66 passed, 0 failed     turning a thesis into a signal
ticket         43 passed, 0 failed     the order handoff and the unit trap
session        30 passed, 0 failed     market hours, both sides of DST
-----------------------------------------------------------------------
TOTAL         704 passed, 0 failed

$ npm run typecheck
tsc --noEmit                            clean

$ npm run build
Compiled successfully in 2.4s
```

Checks run against the **live deployment**, 17 Sep 2026:

```text
GET /                        200    1.41s
GET /attack                  200    0.93s
GET /activity                200    1.40s
GET /thesis/nvda-4sjmtx      200    1.37s
GET /thesis/tsla-c5qqql      200    1.45s
GET /api/session             200    BTC/USDT rsi 45.7, live from a Bitget Skill
GET /api/diag                200    bitget ok, yahoo ok, edgar ok
browser console on load             clean, zero errors

POST /api/attack  (a full thesis run, end to end)
  resolve                     196ms
  take the thesis apart      6273ms
  write the tripwires        3206ms
  read the real numbers      1420ms
  second opinion (Qwen)      3617ms, ran alongside, added 1 assumption
  -------------------------------------------
  total                     13479ms, 5 model calls
```

Live sponsor checks, run on demand:

```text
$ npm run qwen:check -- 3 --compare
  with the flag        3 of 3 answered     3263ms / 4010ms / 4080ms
  the old way          failed after 45011ms

$ npm run cron:check
  TSLA   checked every 15 minutes, 0 missed in the last 24h
  NVDA   checked every 15 minutes, 0 missed in the last 24h
```

---

## What is real, and what is not

We would rather tell you than have you find out.

**Real, running right now, on live data:**
Taking a thesis apart. The Qwen second opinion. Writing and reading tripwires. Live prices, candles and order book depth from the Bitget Agent Hub SDK. Real fundamentals from SEC EDGAR filings, with a clickable link to the exact filing behind every number. The 15 minute recheck loop. Telegram alerts. The historical reconstruction. The self-grading autopsy. The order handoff.

**Real but limited:**
One of five bitget-signal Skills answers. We use that one and probe all five live. The other four are unreachable from Bitget's host and we report that rather than hide it.

**Reconstructed, and always labelled:**
Sixty of the 150 checks on each live thesis were rebuilt from historical data, so they show what THESIS would have told you. Never presented as warnings you received.

**Deliberately not built:**
THESIS **cannot place a trade** and holds no exchange key. Bitget hands an agent account's credential to a program on your own machine, so a hosted website has no business touching it. Instead, THESIS produces an order correct to the exchange's own decimal places and hands it to you, for the agent where your account is already connected:

```json
{ "category": "SPOT", "symbol": "RTSLAUSDT", "side": "buy",
  "orderType": "limit", "price": "367.39", "qty": "282.6299",
  "timeInForce": "gtc", "clientOid": "thesis-tsla-mu5pjf2a" }
```

Checked against the exchange's real rules before you ever see it, and sized against the real order book: 282.6299 shares at 367.39 comes to 103,835.39 USDT against a depth-derived cap of 103,835.42. It rounds **down**, never up, and tells you it did.

**No news feed.** We could not find a working one. Rather than return an empty list, which would read as "there is no news", the code says plainly that no news source is wired.

**Fixtures.** The `/lab` route is an internal component gallery and its numbers are fixed examples, not live output. Nothing in the product itself ever reads a fixture.

---

## Quick start

```bash
git clone https://github.com/MikeMoulder/thesis.git
cd thesis/thesis
npm install
cp .env.example .env
npm test
npm run dev
```

Open http://localhost:3100.

`npm test` needs no keys and no network, so it works immediately. To run the live product you need two free things:

| Key | What it is for | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Taking the thesis apart and writing the tripwires | [aistudio.google.com/apikey](https://aistudio.google.com/apikey), free tier |
| `QWEN_API_KEY` | The second opinion. Optional. Without it the app runs and says the second opinion did not run | Bitget hackathon gateway |

Optional, for the always-on half: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to remember your theses, `RECHECK_SECRET` for the 15 minute loop, and `TG_BOT_TOKEN` plus `TG_WEBHOOK_SECRET` for Telegram alerts. Every key is documented in [`.env.example`](thesis/.env.example).

Bitget market data needs **no key at all**, because we only use public read-only endpoints. Note that `api.bitget.com` is blocked in some countries. If Bitget calls fail with a connection error rather than an error message, check your network before you check our code.

Useful commands:

```bash
npm test                          all 704 tests
npm run qwen:check -- 3 --compare prove the sponsor model answers
npm run health                    check every data source
npm run cron:check                confirm the 15 minute loop is running
npm run tg:check                  confirm Telegram is connected
```

---

## Limitations

- **One of five Bitget Skills works.** Their upstreams are down, not ours. We probe live and report it.
- **No news source is connected**, so tripwires that would depend on events are honestly reported as uncovered.
- **No market holiday calendar.** On Thanksgiving the overnight panel hides instead of appearing. We chose the direction that shows less rather than the one that could state something false.
- **THESIS cannot trade.** By design, permanently.
- **Two theses are seeded** on the live deployment so there is something with real history to look at. You can add your own from the front page and it joins the same loop.

## Where this goes

**Built and running:** everything described above.

**Next:** a working news source so event-driven tripwires can be covered. A market holiday calendar. More than one person's theses on one deployment.

**The idea it is heading towards:** a research desk that remembers every reason you have ever given for a trade, and is honest with you about which ones kept working. Not a tool that tells you what to buy. A tool that will not let you quietly forget what you said.

---

**THESIS does not tell you what to trade. It tells you when the reason you gave has stopped being true.**

Research, not advice. You decide.
