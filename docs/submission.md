# Submission form answers

Copy and paste, field by field, in the order the form asks. Every figure was checked against the running deployment on **7 October 2026** and carries one of three labels, as the rules ask: **[observed]** measured on the live system, **[estimated]** worked out from observed numbers, **[targeted]** a goal, not a result.

Source of the rules: https://bitget-ai.gitbook.io/bitgetai_hackathons2 (Chapter IV). The Project Description is one field in six parts; judges weigh parts 1 to 3 most. A GitHub link cannot replace it.

---

## Track and sub-theme

**Track 3: AI Trading Desk**
**Sub-theme: Decision Stress Testing**

---

## Project name

```text
THESIS
```

---

## Project Description

### 1. Thesis

Every investor writes down why they bought something, and almost nobody goes back to check whether those reasons are still true. Weeks later the position is down, the reasoning is half remembered, and the decision to hold or sell gets made by looking at the price, the one input that says nothing about whether you were right.

Tokenized US stocks make this sharply worse. An rToken trades every hour of every day; the company behind it reports four times a year. The position moves constantly while the reasons behind it barely move, and nobody is awake at 3am when one of those reasons quietly stops being true.

**Why existing tools fall short.** Price alerts watch the one number that does not tell you whether you were right. Screeners and AI chat assistants answer questions about a stock, but forget the question the moment the tab closes, and they never ask what *your* trade depends on. None of them separates what you claimed from what you silently assumed, and none of them keeps watching.

**Our core hypothesis: the useful unit of research is not a price target, it is a falsifiable condition.** THESIS takes the sentence a person actually wrote, finds every belief it rests on (including the ones they never said), puts an exact number under every belief that can be measured, and re-reads those numbers from live filings and prices every fifteen minutes, forever. When nothing can test a belief, it says so in those words instead of substituting a number that looks close. It does not tell anyone what to buy. It will not let them quietly forget what they said.

### 2. Target user and product value

**Who:** self-directed retail investors who hold tokenized US stocks on Bitget for weeks to months, not day traders.

- **Risk appetite:** moderate to high; comfortable holding single names like NVDA, TSLA or AMD through drawdowns of 20 to 30 percent.
- **Capital:** roughly $5,000 to $250,000 across 2 to 10 positions **[estimated]**.
- **Trading frequency:** a few entries or exits a month, each with a reason they could state in a sentence.
- **Primary market:** US equities through rTokens, which trade 24/7 while the person sleeps.
- **Use case:** "I bought this for three reasons. Tell me the moment one of them stops being true, before the price tells me."

**Why this segment needs it:** they hold positions through every night and weekend the rToken trades and the underlying market is shut, with reasoning that lives only in their head. They are too busy to read a 10-Q at 11pm, and too disciplined to want a tool that tells them what to buy.

**What they get, in order of how much it matters:**

1. **The beliefs they did not know they had.** On live AMD runs, a two-sentence thesis rested on five beliefs, three or four of which the person never wrote down, including that a 25 percent stop assumes someone will actually be bidding when it triggers **[observed, 7 Oct]**.
2. **A verdict first.** Every analysis opens with the answer, such as "2 of the 5 things this trade rests on have already broken", then each belief worst first, with its live reading, its line and its source (a specific SEC filing or Bitget endpoint).
3. **Honesty about the blind spots.** Beliefs nothing can measure are labelled "can't check", never covered with a number that looks close.
4. **Notice.** Re-checked every 15 minutes; Telegram delivers the moment a belief changes state.
5. **What their positions have in common.** Across a person's theses, THESIS finds beliefs that share one outside driver. On the live theses it found that TSLA needs AI spending to slow while NVDA needs it to accelerate, so they cannot both be right, and that both break on the same market-wide sell-off.
6. **An exit sanity check most tools skip:** real resting order book depth on the rToken, not a quoted price.

Each person's theses are private to them, with no sign-up; signing in with Telegram carries them to any device.

### 3. Validation data and key metrics

THESIS is a research tool, so the metrics are about whether it does the research task correctly and reliably, and whether people would come back.

**The research task, end to end:**

```text
analyses completed, live data, 7 Oct                  4 of 4        [observed]
time to the verdict (main path, 4 model calls)        9.6 to 9.8s   [observed]
time until the second opinion has also answered      20 to 22s     [observed]
model calls per analysis                               4 to 5        [observed]
model calls per 15-minute re-check                     0             [observed]
```

**The 24/7 loop:**

```text
re-check cadence                                      every 15 min  [observed]
missed ticks in the last 24 hours                     0             [observed]
running continuously since                            16 Sep 2026   [observed]
stored log per thesis                                 500 checks: 76 reconstructed days
                                                       (15 Jun to 1 Oct) + 424 observed live
```

**Does the warning arrive before the break?** The product grades itself. On the TSLA thesis, "90-day realised volatility will not push above 50%" first weakened on 16 June and broke on 7 July: **21 days of warning [observed in reconstructed history]**. Reconstructed checks are labelled as such on every row, because a warning that was never delivered is not a warning. On NVDA the reconstructed span contains no change of state, and the product says so rather than presenting it as one.

**Does the cross-thesis reading get the direction right?** On the live TSLA and NVDA theses, the relation between them (opposed on AI spending) was correct in **3 of 3 runs [observed]**. Code derives "opposed" or "shared" from per-belief directions; asked for the label directly, the model got it backwards, so it is never asked for it.

**Engineering:**

```text
self-tests                    826 passed, 0 failed, 22 suites     [observed]
runs with no network or keys  yes, reproducible on any machine    [observed]
source health for the UI      1.1s (was 7s)                        [observed]
```

**Users:** no external test users yet **[observed]**. Validation so far is process based on purpose: whether a thesis "was right" is not measurable inside one month, and a model already knows how past events turned out, so backtesting its judgement would measure recall rather than reasoning. What is measurable is whether claims are grounded in real sources, whether unstated assumptions are found, whether coverage is never faked, and how much warning arrives. Those are what the numbers above measure.

**How we will prove usage and distribution [targeted]:**

```text
month one users, from X and the Bitget Builders Telegram      50
analyses saved as watched theses, per user                   2 or more
users who connect Telegram (the retention channel)           30%
users who return in week two                                 40%
alerts that lead to opening the thesis page                  50%
```

Every one of these is measurable from data the product already stores: owned theses, Telegram bindings, alert counts and check logs.

### 4. Progress

**Built and live:**

- Thesis decomposition into claims and stated and unstated assumptions (Gemini 3.5 Flash Lite)
- A second opinion on Qwen 3.8 Max, a different model family, that can only add
- Tripwire generation with an honest refusal to cover what cannot be measured
- An evaluator that reads live data with zero model calls
- Bitget Agent Hub SDK: the tokenized stock catalogue, 24/7 prices, candles and the order book
- SEC EDGAR fundamentals, linked to the exact filing behind every number
- A 15-minute re-check loop, running since 16 September; Telegram alerts routed to each thesis's owner
- Event tripwires watched through Google News search: headlines that may report the event, shown with links, never treated as a verdict
- Verdict-first analysis: one list of beliefs, worst first, each with its own gauge and source
- Cross-thesis view: shared and opposed beliefs across a person's positions
- Private theses with no sign-up; Sign in with Telegram for other devices
- Historical reconstruction with strict knowable-date discipline, labelled on every row
- Six preset stress tests and free-form what-if scenarios
- A self-grading autopsy that measures its own warning time
- Signal derivation and an exchange-accurate order handoff, zero model calls; THESIS never places an order
- Phone layout, thesis search, live probing of all five bitget-signal Skills

**Problems we hit, and the fix:**

- **Qwen never answered.** Every call timed out at 45s. It is a reasoning model whose hidden thinking used the whole budget on a hard prompt. Turning hidden thinking off took it from never answering to about 4 seconds; 10 of 10 calls answered through the live path.
- **The analysis was hard to read.** The same beliefs appeared four times and the answer came last. Rebuilt verdict first, as one list; the same run is now half the length.
- **History was being trimmed away.** The log kept only the newest 500 checks, about five days, and lost every older change of state. It now drops routine checks first and always keeps the record.
- **Strangers' theses were visible and deletable.** Fixed with private identities and owner-only changes.

**Not built yet:** reading news articles (event tripwires are matched on headlines, shown as "may report this", never as a verdict); Bitget's US stock data service, `bitget-mcp-server`, which returned 503 on every data query when we integrated on 7 October; a market holiday calendar.

**Next:** news and earnings dates from Bitget's data service once it answers; analyst consensus as a tripwire source; a shareable card per thesis.

**Stack:** Next.js 16, TypeScript, Upstash Redis, Vercel; Bitget Agent Hub SDK, bitget-signal Skills over MCP; SEC EDGAR; Yahoo Finance for long price history; Google News search RSS for event tripwires; Gemini 3.5 Flash Lite and Qwen 3.8 Max; Telegram Bot API.

### 5. Deliverables

Everything is reachable from the one link in "Submission Materials Link":

- **Live demo:** https://thesis-stocks.vercel.app. No sign-up; write a trade and the reason for it.
- **A thesis under observation**, with reconstructed history and its self-graded warning: https://thesis-stocks.vercel.app/thesis/tsla-c5qqql
- **Every change of state, as it was recorded:** https://thesis-stocks.vercel.app/activity
- **Live source health:** https://thesis-stocks.vercel.app/api/diag
- **Source code and README:** https://github.com/MikeMoulder/thesis
- **The required complete research task, question to actionable insight:** https://github.com/MikeMoulder/thesis/blob/main/docs/walkthrough.md
- **Test logs:** in the README; `npm test` reproduces 826 checks offline.

### 6. Our take on AI trading

**Point AI at the reasoning, not at the prediction.** Asking a model what happens next is the thing it is worst at, and its failures are the hardest to notice, because a confident wrong answer looks exactly like a confident right one. We used it for what it is genuinely good at and people are bad at: reading a paragraph carefully and noticing what it takes for granted. On one run Qwen pointed out that the thesis had "conflated top-line share metric with bottom-line value creation". Winning share is not making money.

Three rules follow, enforced in code rather than promised: the model never touches a number; the model is allowed to say it cannot tell; and the human keeps the decision. The market data client is built read-only with no credentials, so THESIS cannot place an order. That is an inability, not a policy.

---

## Role of the LLM in Your Project

**Four jobs, all comprehension rather than prediction. No model output is ever treated as a fact about the world, and every one is checked by code before it is used.**

1. **Taking the thesis apart.** Gemini 3.5 Flash Lite separates claims from assumptions and marks which the person stated and which their reasoning silently requires. Strict schema, a repair pass, and any assumption citing data the system cannot reach is downgraded rather than kept.
2. **Writing the tripwires.** The same model turns each testable assumption into a metric, an operator, a threshold, a source and a schedule. It is allowed to answer "nothing here can test this", and does.
3. **The second opinion, on Qwen.** Qwen 3.8 Max, through Bitget's hackathon gateway, reads the same thesis independently and adds load-bearing assumptions the first model missed. It runs alongside the main path and can only add, never edit.
4. **Reading across theses.** For the cross-thesis view, a model groups beliefs from different positions by the outside driver they share, and for each belief says only whether that position needs more or less of it. Code works out "opposed" or "shared" from those answers and drops any group it cannot verify.

A fifth job, on its own seat, answers follow-up questions from a finished analysis using only what is on the page. Three model seats in all: the decomposer (jobs 1, 2 and 4), the Qwen second opinion, and follow-ups.

**What the LLM does not do:** evaluate any reading (pure data, zero model calls), derive signals or size positions (arithmetic), build orders (exchange rules), or predict prices (never, anywhere).

**Qwen, and whether it met our needs:** yes, once one setting was found. `qwen3.8-max` is a reasoning model; on a real prompt its hidden reasoning consumed the whole token budget and calls timed out at 45 seconds. With `enable_thinking: false` it answers in about 4 seconds, 10 of 10 calls through the live code path (2.97s fastest, 8.43s slowest) **[observed]**. Using a different model family for the second reader reduces how much a result depends on one model's habits; it does not make them independent, and we say so in the code.

---

## Submission Materials Link

One field. Paste the repository; its README links every item in part 5:

```text
https://github.com/MikeMoulder/thesis
```

If the field accepts several lines, use this instead:

```text
Live demo: https://thesis-stocks.vercel.app
Code and README: https://github.com/MikeMoulder/thesis
Research task walkthrough: https://github.com/MikeMoulder/thesis/blob/main/docs/walkthrough.md
Thesis under observation: https://thesis-stocks.vercel.app/thesis/tsla-c5qqql
```

---

## X Promotional Post Link

**Required, and the one thing that makes an entry invalid on its own.** The post must include `#BitgetHackathon` and `@Bitget_AI`, must introduce what was built (a bare retweet does not count), and must **quote** this post:

```text
https://x.com/Bitget_AI/status/2100519318824055159
```

A draft to post as a quote of that link:

```text
Most trading tools watch the price. THESIS watches your reasons.

Write why you bought a tokenized stock. It finds every belief that trade rests on, even the unspoken ones, and tells you on Telegram the moment one breaks.

https://thesis-stocks.vercel.app

#BitgetHackathon @Bitget_AI
```

---

## Optional fields

| Field | Answer |
|---|---|
| University Name | Leave blank unless you are entering as a university team. If you fill it in, the entry is judged for the university prize only if it wins nothing else. |
| Apply for Demo Day | **Yes.** Any team may tick it; winners and high scorers are invited first. |
| Apply for K3 Token Subsidy | **Yes.** Free, and only paid to valid entries. |
| S1 participant | Answer truthfully. If yes, the form asks for substantive new additions. |

---

## Before submitting

```text
[ ] Post on X: quote the Bitget_AI post above, include #BitgetHackathon and
    @Bitget_AI, introduce the product. Paste the link into the form.
    THIS ALONE MAKES AN ENTRY INVALID IF MISSING.
[ ] Paste parts 1 to 6 above into the single Project Description field.
[ ] Paste the Role of the LLM section into its own field.
[ ] Paste the materials link.
[ ] Tick Demo Day and the K3 subsidy.
[ ] Optional: fill the GitHub About box (description, homepage, topics).
[ ] Optional: record a short demo video (not required for Track 3).
```
