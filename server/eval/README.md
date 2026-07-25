# Food-parse eval

A repeatable measurement of what the parse chain actually returns, so that
changing the model, the prompt, the reasoning effort or the provider order is a
decision with a number attached instead of a hunch.

This exists because the work kept happening without leaving a trace. The move to
`gemini-3.6-flash` (2026-07-21) was decided on a 180-call comparison — 100 %
recall, zero refusals, p95 1.6 s / 2.5 s, ~5× cheaper — and none of it is in this
repository. The run cannot be reproduced, the next model change has nothing to
compare against, and from the outside it looks like no evaluation was ever done.

## Running it

The runner hits a **running** service and spends real provider and model quota.
That is why it is a manual tool, not a CI job.

```bash
cd server
npm run eval                                    # http://127.0.0.1:8787
BASE_URL=https://food.family-pie.ru APP_TOKEN=… npm run eval
```

Record a baseline, then gate later runs on it:

```bash
npm run eval -- --save eval/baselines/2026-07-25-gemini-3.6-flash.json
npm run eval -- --baseline eval/baselines/2026-07-25-gemini-3.6-flash.json
```

With `--baseline` the process exits non-zero on a regression: pass rate down
more than 5 points, empty rate up more than 5 points, or p95 more than 1.5×.
Improvements never fail a run.

Environment: `BASE_URL`, `APP_TOKEN`, `EVAL_CONCURRENCY` (default 1 — the service
is rate-limited and this is not a load test), `EVAL_TIMEOUT_MS` (default 30000).

## What it measures, and what it refuses to

**Measured**

- **Pass rate** — how many cases satisfied every expectation in `cases.json`.
- **Empty rate** — parses that returned no items at all. This is the metric the
  user feels: it is what «не распозналось» looks like from the inside.
- **Latency** p50 / p95 / max, nearest-rank so every number printed was really
  observed by some request.
- **Provenance** — how many items each source produced (`skurikhin`, `usda`,
  `fatsecret`, `ai_estimate`, `estimate`…). A run whose pass rate held up only
  because `ai_estimate` replaced real DB rows has not held up.

**Deliberately not measured: calorie accuracy against a reference value.**
There is no ground truth for «борщ» — recipe, fat and portion move the honest
answer by a factor of two. A reference number would have to be invented, and the
eval would then measure agreement with our own guess and call it accuracy.
Instead each case asserts a wide plausibility band, the identity of the matched
row, and whether the numbers came from a database or from the model.

## The cases

`cases.json` — 24 cases: 18 RU, 4 US, 2 negative. Each carries a `note` saying
why it is there. Several are regressions with a history:

- `ru-tarhun-lemonade` — resolved to «Сушеный эстрагон» and returned 974 kcal
  for a soft drink (fixed 2026-07-20, PR #163).
- `ru-protein-pudding` — matched through FatSecret while hiding which row the
  numbers came from (PR #154).
- `ru-instant-noodles`, `ru-buckwheat-cooked` — the dry↔cooked trap, the single
  largest error source in the whole chain.
- `ru-nonsense-input`, `ru-non-food` — inventing food where there is none is how
  phantom calories enter a day.

Add a case whenever a real mis-parse is found. That is the point: the set should
grow by exactly the bugs that actually happened.

**A known limit of the negative cases:** with `minItems: 0` and no band, they
pass whether the service returns nothing or invents a meal. They document the
intent and pin the non-crash; they do not yet catch fabrication. Tightening this
needs a "must return nothing" expectation, which the scorer does not have.

## Trusting the numbers

`score.ts` is pure and covered by `test/evalScore.test.ts` (10 tests, run by CI).
The judge is checked even though the runner cannot be — an unverified harness
produces numbers that look like evidence.
