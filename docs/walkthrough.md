# A complete research task, start to finish

This is one real research task run on the live deployment on 17 September 2026. Every number, every sentence and every timing below is copied from that run. Nothing is illustrative.

The task: **a person thinks AMD is a good buy and wants to know what they are actually betting on, and what would tell them they were wrong.**

You can run the same thing yourself. Instructions are at the bottom.

---

## Step 0: the question a person really has

Not "what is AMD worth". Nobody can answer that. The question underneath it is smaller and much more useful:

> I think this is a good trade. What am I assuming without realising it, which of those assumptions can actually be checked, and how will I find out if one stops being true while I am asleep?

That is the task THESIS performs.

---

## Step 1: say it in plain English

The person opens the desk and types the way they would talk:

```text
I am long AMD because data centre GPU share keeps rising and gross margins
stay above 50 percent. I am wrong if it falls 30 percent from the high.
```

No form. No dropdowns. No ticker field. Just the sentence.

---

## Step 2: find the company, the token, and the filings

**Took 207 milliseconds.**

THESIS reads "AMD" and connects three different identities for the same company:

| Identity | Source | Why it is needed |
|---|---|---|
| `RAMDUSDT`, the tokenized stock | Bitget Agent Hub SDK, live catalogue of 1,175 tokenized stocks | The thing that actually trades, 24 hours a day |
| `AMD`, the listed equity | Yahoo Finance | Long price history. A tokenized stock is only months old, which is far too short to measure anything |
| `0000002488`, the SEC filer | SEC company index | The real financials, filed and legally binding |

This matters more than it sounds. The price you are exposed to comes from the token. The history you need comes from the equity. The facts come from the filings. **Most tools use one of those and quietly pretend it is all three.**

---

## Step 3: take the thesis apart

**Took 2.75 seconds.**

The model reads the sentence and separates what is being claimed from what is being assumed. Here is the real output.

**The claim:**

> AMD outperforms over a 6-month horizon driven by data center GPU share gains and stable gross margins

**The things that have to be true for that claim to hold:**

```text
A1  STATED    high    Company-wide quarterly gross margins remain at or
                      above 50 percent

A2  IMPLICIT  high    The position can be closed near the stop-loss level of
                      a 30 percent drawdown from the high rather than at an
                      empty bid

A3  IMPLICIT  medium  The market has not already fully priced in the expected
                      data center GPU share gains at the current valuation
                      multiple

A4  IMPLICIT  medium  AMD successfully captures rising data center GPU demand
                      by growing its specific revenue share against
                      competitors
```

**The person wrote one of these. The other three, they did not.**

Look at A2 in particular. The person said "I am wrong if it falls 30 percent". Underneath that sentence is a belief they never examined: that when it falls 30 percent, **somebody will actually be there to buy it from them.** For tokenized stocks that is not a safe assumption at all, and we will come back to it in step 6.

---

## Step 4: a second model looks for what the first one missed

**Took 4.66 seconds, and it ran alongside the next step rather than holding it up.**

The most valuable thing this product finds is the assumption nobody wrote down. The most likely way it fails is missing one. Asking the same model to check its own work does not help much, because it reaches for the same ideas the second time.

So a different model from a different family reads the same thesis independently. This runs on **Qwen**, through Bitget's hackathon gateway. It is only allowed to **add**, never to edit or overwrite what the first model concluded, so you can always tell which model said what.

On this run it found two more, and explained why each was missed:

```text
A5  IMPLICIT  high    No macro or sector-wide shock drags AMD down 30%
                      regardless of company-specific GPU progress.
                      why missed: "Focus stayed on company fundamentals,
                                   ignoring systemic risk"

A6  IMPLICIT  medium  Data center GPU share gains translate into net earnings
                      growth sufficient to support the stock price.
                      why missed: "Conflated top-line share metric with
                                   bottom-line value creation"
```

Both are real. A5 is the obvious one in hindsight: the whole thesis is about AMD, and none of it survives a market-wide crash. A6 is sharper, and the explanation is the best line in the run. **Winning market share is not the same as making money.** The thesis quietly assumed one leads to the other.

Final count: **one claim, six assumptions, and five of the six were never said out loud.**

---

## Step 5: turn each belief into a number

**Took 3.06 seconds.**

A belief you cannot check is just a feeling. So every assumption that can be measured gets a tripwire: a metric, a comparison, a threshold, a source, and a schedule.

```text
B1  watches A1   gross margin        < 50        checked when a filing lands
B2  watches A2   drawdown from high  <= -30%     checked continuously
B3  watches A2   exit depth          < $25,000   checked continuously
B4  watches A3   price to earnings   > 150       checked continuously
B5  watches A5   drawdown from high  <= -30%     checked continuously
```

Two details worth pausing on.

**A2 got two tripwires, not one.** "I can get out at my stop" is really two separate claims: that the price reaches the level, and that somebody is there when it does. B2 watches the first. B3 watches the second. Almost nothing splits those.

**B2 and B5 measure the same thing for different reasons.** A2 is about being able to exit. A5 is about a market-wide shock. Both happen to be testable by the same measurement, and THESIS keeps them separate rather than merging them, because when it fires you need to know **which belief just failed.**

### And the two it refused to fake

```text
A4  no available data can test this assumption
A6  no available data can test this assumption
```

This is the part we care about most. Nothing THESIS can reach measures "is AMD actually winning share against competitors" or "does that turn into earnings". It could easily have invented something that looks close, like revenue growth, and called it covered.

It says it cannot check them instead. **Two of the six things this trade rests on are unwatched, and the person is told exactly which two.**

---

## Step 6: go and read the real numbers

**Took 1.13 seconds, and used no AI at all.**

This step is pure data. That is what makes it cheap enough to repeat every fifteen minutes forever.

| Tripwire | Reading now | Breaks at | Verdict | Where the number came from |
|---|---|---|---|---|
| B1 gross margin | 53.77% | below 50% | holding | Computed from SEC 10-Q `0000002488-26-000123` |
| B2 drawdown | -6.78% | at -30% | holding | Yahoo Finance AMD, 1 year daily |
| B3 exit depth | $57,352 | below $25,000 | holding | **Bitget spot order book, RAMDUSDT, via the Agent Hub SDK** |
| B4 price to earnings | 140.20 | above 150 | holding | **Bitget spot ticker RAMDUSDT** combined with SEC filings |
| B5 shock drawdown | -6.78% | at -30% | holding | Yahoo Finance AMD, 1 year daily |

Every one of those is traceable. The gross margin is not a number we found somewhere, it is gross profit divided by revenue **from the same filed quarter**, and the filing is one click away.

**B3 and B4 are the ones only this project can do.** B3 reads the real resting orders on Bitget and adds up what is actually there to sell into. B4 takes the live 24/7 token price, multiplies by the share count from the filings, and divides by earnings from the filings. That is a valuation of the company computed from a price that exists at 3am on a Sunday.

---

## Step 7: what the person is told

The desk answers in the order a person actually thinks, not in the order the machine computed:

1. **What you are betting on.** The claim, in one line.
2. **What it rests on.** Six things, with the ones they never said flagged hardest.
3. **Where the numbers stand.** Each tripwire with how much room is left before it fires.
4. **If you watch one thing.** The nearest tripwire to firing, and whether it can move today or only when a filing lands.
5. **What only you can settle.** The beliefs nothing can check, stated plainly.

That last section is the one most tools would delete. It is the honest answer to "what can this tool not do for me", and putting it on the screen is the reason the rest is believable.

**Whole run: 9.45 seconds, 4 model calls, 2 models.**

```text
resolve      207ms
decompose   2750ms
tripwires   3057ms
evaluate    1125ms
second opinion (Qwen)  4659ms, ran alongside, added 2 assumptions
-----------------------------------------------------------
total       9451ms     4 model calls
models      gemini-3.5-flash-lite + qwen3.8-max
```

---

## Step 8: the research task does not end. It starts.

This is where THESIS stops being a report.

The person saves the thesis. From that moment, **every fifteen minutes, forever**, those five tripwires are read again from live filings and live prices. No AI is involved, which is exactly why it can run that often.

On the two theses that have been live longest, the record is:

```text
TSLA   150 checks   22 Jun 2026 to 17 Sep 2026   0 missed in the last 24h
NVDA   155 checks   22 Jun 2026 to 17 Sep 2026   0 missed in the last 24h
```

Sixty of each are reconstructed from history, and every reconstructed row says so on the row itself, because **a warning you were never actually given is not a warning.**

---

## Step 9: the moment something moves

When a tripwire changes state, Telegram delivers this, in full, wherever the person is:

```text
🔴 TSLA  1 broken, 1 weakening

"90-day realised volatility will not push above 50%."
BROKEN, was weakening
volatility 57.57% crossed 50.00%
Yahoo Finance TSLA 1y/1d

"Year-over-year revenue growth will remain at or above 25%."
WEAKENING, was healthy
revenue growth 25.52% closing on 25.00%
SEC 10-Q 0001318605-26-000091

Checked 7 Jul 14:15 UTC.
https://thesis-stocks.vercel.app/thesis/tsla-c5qqql
```

The sentence they wrote, the number, the line it crossed, and the filing behind it. One message per thesis, only when something genuinely changed.

---

## Step 10: the desk grades its own homework

After enough checks, THESIS reads its own log and reports on itself. On the live TSLA thesis:

> **The first warning came 14 days before anything broke.**
>
> "90-day realised volatility will not push above 50%" weakened on 23 Jun 2026 and broke on 7 Jul 2026.

Fourteen days is a measurement, not a promise. And where nothing has broken, it refuses to celebrate:

> "Nothing has broken yet. That is not the same as nothing being at risk, and it says nothing at all about the parts no tripwire covers."

---

## Step 11, optional: what this implies you should actually do

If the person asks, THESIS converts the analysis into a concrete order, using **no AI at all**. Every number is a rearrangement of readings it already took.

It reads the live Bitget order book, works out how much can be bought before the exit would start walking the price down, and writes the order to the exchange's own decimal rules:

```json
{ "category": "SPOT", "symbol": "RTSLAUSDT", "side": "buy",
  "orderType": "limit", "price": "367.39", "qty": "282.6299",
  "timeInForce": "gtc", "clientOid": "thesis-tsla-mu5pjf2a" }
```

282.6299 shares at 367.39 is 103,835.39 USDT, against a depth-derived ceiling of 103,835.42. It rounds **down**, never up, and says so.

**THESIS cannot place this order.** It holds no key and has no account. Bitget hands an agent account's credential to a program on your own machine, so a hosted website has no business touching it. The order is handed to you in two forms, a plain English sentence and the exact machine payload, for the agent where your account is already connected.

---

## Run this yourself

```bash
git clone https://github.com/MikeMoulder/thesis.git
cd thesis/thesis
npm install
cp .env.example .env     # add GEMINI_API_KEY to run a live analysis
npm run dev
```

Open http://localhost:3100 and type a thesis.

To check the parts that do not need any keys:

```bash
npm test                          704 tests, no network, no keys needed
npm run health                    are Bitget, Yahoo and SEC reachable
npm run qwen:check -- 3 --compare prove the sponsor model answers
npm run cron:check                is the 15 minute loop actually running
```

Or skip all of it and open the live deployment:

- [The desk](https://thesis-stocks.vercel.app)
- [A thesis under observation, with its full history](https://thesis-stocks.vercel.app/thesis/tsla-c5qqql)
- [Every check ever run](https://thesis-stocks.vercel.app/activity)
- [Live source health, including all five Bitget Skills](https://thesis-stocks.vercel.app/api/diag)

---

## What this walkthrough deliberately showed you

- An assumption the user never wrote down, found and flagged (A2, A3, A4)
- **Two more found by the sponsor's own model**, with reasons (A5, A6)
- A belief split into two separate tripwires because it was secretly two beliefs (A2)
- **Two beliefs the system refused to fake coverage for** (A4, A6)
- Numbers traced to a specific SEC filing and a specific exchange endpoint
- A valuation computed from a price that exists at 3am
- Liquidity read from a real order book, not assumed
- The loop continuing after the report, and reaching a phone
- The product measuring its own warning time, and admitting when it has none
