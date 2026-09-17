# Submission form answers

Copy and paste. Every claim here matches what the code does on 17 September 2026, checked against the running deployment rather than against intent.

**Why the model call numbers below say four or five and not six.** An earlier version of this project declared eight model seats, five of which (fundamentals, market, news, bull and judge) were configured, documented, and never once called. They were deleted on 18 Sep, along with the quota text in `.env.example` that described them. Three seats run now: the decomposer, the Qwen second opinion, and a follow-up seat. If you find any older note claiming a six-call pipeline, it predates that cleanup and is wrong.

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

## 140 character summary

```text
Write down why you bought it. THESIS finds every belief hiding in that sentence, puts a number under each, and watches them 24/7.
```

(128 characters.)

---

## Full project description

### The thesis behind the project

Every investor writes down why they bought something, and almost nobody goes back and checks whether those reasons are still true. Weeks later the position is down, the original reasoning is half remembered, and the decision to hold or sell gets made by looking at the price. The price is the one input that tells you nothing about whether you were right.

Tokenized US stocks make this sharply worse. An rToken trades every hour of every day. The company behind it reports four times a year. The thing you own moves constantly while the reasons you bought it barely move at all, and nobody is awake at 3am to notice the moment one of those reasons quietly stops being true.

THESIS is built on one belief: **the useful unit of research is not a price target, it is a falsifiable condition.** So it takes the sentence a person actually wrote, separates what they claimed from what they assumed, puts an exact number under every assumption that can be measured, and then watches those numbers around the clock. It is deliberately not a tool that tells you what to buy. It is a tool that will not let you quietly forget what you said.

The part that makes it honest is the part most tools would remove: when nothing available can test an assumption, THESIS says so in those words rather than substituting a number that looks close. On a live run for AMD, two of six assumptions came back as untestable and were reported as untestable. That is the feature, not a gap in it.

### Target user and the value delivered

A self-directed investor holding tokenized US stocks, who trades on reasoning rather than on signals, and who is asleep for most of the hours their position is live.

What they get, concretely:

1. **The beliefs they did not know they had.** On a real AMD run, the user wrote one assumption and the system surfaced five more they had never stated, including that a 30 percent stop implies somebody will actually be bidding when it triggers.
2. **A number under each belief**, with the source attached, so a claim can be traced to a specific SEC filing or a specific exchange endpoint.
3. **An honest list of what cannot be checked**, so they know exactly which parts of their trade are running unwatched.
4. **Notice.** Every fifteen minutes, forever, those numbers are re-read from live filings and live prices, and Telegram delivers the moment one moves. On the longest running live thesis, the first warning arrived fourteen days before anything actually broke.
5. **An exit sanity check that most tools skip.** Half the tokenized stocks we sampled quote a confident price against an empty order book. THESIS reads the real resting depth and sizes positions against it.

### Validation data and metrics

**Two theses have been under continuous observation on the live deployment since 22 June 2026.**

```text
TSLA   150 checks   22 Jun to 17 Sep 2026   90 observed live, 60 reconstructed
NVDA   155 checks   22 Jun to 17 Sep 2026   94 observed live, 60 reconstructed
cron   every 15 minutes, 0 missed in the last 24 hours
```

Reconstructed checks are labelled as reconstructed on every row, because a warning that was never delivered is not a warning.

**The headline measurement, produced by the product about itself:**

> The first warning came 14 days before anything broke. "90-day realised volatility will not push above 50%" weakened on 23 Jun 2026 and broke on 7 Jul 2026.

Where nothing has broken, it reports that instead of claiming success: "Nothing has broken yet. That is not the same as nothing being at risk."

**Engineering validation:**

```text
704 self-tests, 0 failures, across 18 suites
runs with no network and no API keys, so results reproduce on any machine
typecheck clean, production build clean
verified from a fresh git clone on a machine with no prior setup
```

**A full live run on production, measured end to end:**

```text
resolve the company, token and filings      207ms
take the thesis apart                      2750ms
write the tripwires                        3057ms
read the real numbers                      1125ms
second opinion on Qwen                     4659ms, ran alongside, added 2
-------------------------------------------------------------------
total                                      9451ms, 4 model calls
```

**Validation is process based rather than outcome based, on purpose.** Measuring whether a thesis "was right" is not meaningful over three months, and a model already knows how past events turned out, so backtesting its judgement would measure recall rather than reasoning. What is measurable is whether the system grounds claims in real sources, whether it finds unstated assumptions, whether it refuses to fake coverage, and how much warning it gives. Those are what the numbers above measure.

### Progress

Built entirely inside the hackathon window, and fully deployed.

**Working and live:**

- Thesis decomposition into claims and stated and unstated assumptions
- A second opinion on Qwen, from a different model family, that can only add
- Tripwire generation, with an honest refusal to cover what cannot be measured
- A three mode evaluator reading live data with no AI involved
- Bitget Agent Hub SDK for the tokenized stock catalogue, live 24/7 prices, candles and the order book
- SEC EDGAR for real fundamentals, with a clickable link to the exact filing behind every number
- Historical reconstruction with strict knowable-date discipline
- Valuation and liquidity metrics, including exit depth and slippage from real resting orders
- A 15 minute recheck loop running continuously since 16 September
- Telegram alerts, with an expiring single-use binding handshake and a secret-token webhook
- Six preset stress tests, plus free-form "what if" scenarios
- Self-grading autopsy that measures its own warning time
- Signal derivation and an exchange-accurate order handoff, using zero model calls
- Live probing of all five bitget-signal Skills, with the working one surfaced on screen

**Known limits, stated plainly:** one of five bitget-signal Skills answers, because four of their upstreams are unreachable from their host. No news source is connected, so event-driven tripwires are reported as uncovered rather than faked. No market holiday calendar. THESIS cannot place trades and holds no exchange key, permanently and by design.

### Our view on AI in trading

**AI should be pointed at the reasoning, not at the prediction.**

The industry default is to ask a model what will happen next. That is the one thing a language model is worst at, and the one thing whose failures are hardest to notice, because a confident wrong answer looks exactly like a confident right one.

We used it for something it is genuinely good at and that humans are genuinely bad at: reading a paragraph carefully and noticing what it takes for granted. On a real run, Qwen surfaced that the thesis had "conflated top-line share metric with bottom-line value creation". Winning market share is not the same as making money. That is a comprehension task, and the model was better at it than the person who wrote the sentence.

Three rules follow from that, and all three are enforced in the code rather than promised:

**The model never touches a number.** Evaluation is pure data reading, no AI at all. That is not only for accuracy. It is what makes checking every fifteen minutes affordable, which is what makes the 24/7 claim real rather than aspirational.

**The model must be allowed to say it cannot tell.** A system that always produces an answer produces a fabricated one whenever it does not know. THESIS reports untestable assumptions as untestable, and it reported two of six on a live AMD run.

**The human keeps the decision, and the system is built so it cannot take it.** The market data client is constructed read-only with no credentials, so it is structurally incapable of placing an order. That is an inability, not a policy.

The honest summary of what AI contributes here: **it reads your reasoning more carefully than you do, and then gets out of the way.**

---

## Role of the LLM

**Three jobs, and all three are comprehension rather than prediction. No model output is ever treated as a fact about the world.**

**1. Taking the thesis apart.** Gemini 3.5 Flash Lite reads the user's paragraph and separates claims from assumptions, marking which the user stated and which their reasoning silently requires. Output is validated against a strict schema, with a repair pass, and any assumption citing data the system cannot actually reach is downgraded rather than kept.

**2. Writing the tripwires.** The same model turns each testable assumption into a metric, an operator, a threshold, a source and a schedule. It is allowed to return "nothing here can test this", and it does.

**3. The second opinion.** Qwen 3.8 Max, through Bitget's hackathon gateway, reads the same thesis independently and looks for load-bearing assumptions the first model missed. It runs alongside the main path rather than blocking it, and it may only add, never edit or overwrite. Anything it adds is validated by the same validator and gets its own tripwire.

A fourth seat answers follow-up questions from a completed analysis, using only what is already on the page.

**A real run makes four or five model calls in total**, not the six an older configuration comment describes.

### What the LLM explicitly does not do

- **It does not evaluate anything.** Reading whether gross margin crossed 50 percent is pure data. Zero model calls.
- **It does not derive signals or size positions.** That is arithmetic over readings already taken. Zero model calls.
- **It does not build orders.** Exchange precision, minimums and depth limits are all rules, not judgement. Zero model calls.
- **It does not predict prices.** Not once, anywhere.

### On using two model families

The claim we make is narrow and we state it in the code as well as here: **running the second reader on a different family reduces how much the result depends on one model's particular habits.** It does not make them independent. They share training data and they will share blind spots.

### One engineering result worth reporting

The Qwen seat did not work for most of the build. Every call timed out at 45 seconds, which looked like an unreliable sponsor service. It was not. `qwen3.8-max` is a reasoning model that generates hidden reasoning tokens before writing any answer, and on a hard question that hidden pass consumed the entire budget before a single word existed.

Measured, holding everything else fixed:

```text
trivial prompt                        answered in about 3s     4 of 4
real prompt, 700 token budget         timed out at 45s         3 of 3
real prompt, 2000 token budget        answered in 41.9s        1 of 1
real prompt, hidden thinking off      answered in  5.2s        1 of 1
```

One setting took it from never answering to about four seconds. Re-measured ten times through the live code path: 10 of 10 answered, 2.97s fastest, 8.43s slowest. The command `npm run qwen:check -- 3 --compare` reproduces both behaviours side by side.

---

## Submission materials

| What | Link |
|---|---|
| Live demo | https://thesis-stocks.vercel.app |
| A thesis under observation, with full history | https://thesis-stocks.vercel.app/thesis/tsla-c5qqql |
| Every check ever run | https://thesis-stocks.vercel.app/activity |
| Live source health, all five Bitget Skills | https://thesis-stocks.vercel.app/api/diag |
| Source code | https://github.com/MikeMoulder/thesis |
| Complete research walkthrough | https://github.com/MikeMoulder/thesis/blob/main/docs/walkthrough.md |
| X post | **not yet posted. Required. The submission is invalid without it.** |
| Demo video | not recorded |

---

## Still to do before submitting

```text
[ ] Post on X with #BitgetHackathon and @Bitget_AI, retweet the official
    announcement, and paste the link into the form.
    THIS IS A NAMED INVALIDITY TRIGGER. Nothing else counts without it.
[ ] Add a screenshot to the README
[ ] Fill the GitHub About box: description, homepage, topics
[ ] Record a short demo video (optional for Track 3)
[ ] Decide on Demo Day and the university prize checkboxes
```
