# Day-1 checks (Oct 27, 2026)

Live calls on the anonymised demo-room footage (`tools/prepare` output). Raw requests and responses are saved in
`fixtures/recorded/` and replayed by the tests. Re-run with `node --env-file=.env scripts/day1/<check>.mjs`.

| Check | Model | Result | Time | Decision |
|---|---|---|---|---|
| Datasheet lookup, Juniper MX104 | Muse Spark 1.3 + `web_search` | PASS: 3.5U, depth 240 mm, 600 W typical / 800 W max, AC or DC, 2 feeds, side-to-side airflow, 14.5 kg; 2 cited sources (hardware guide, datasheet) | 35 s | ~20 searches and 343K input tokens per lookup (about $0.45): store the result per device model and look each model up once |
| Power panel PWR1 | Muse Spark Open (Baseten) | PASS: 8 breakers (3 positive, 5 negative pole), ratings unreadable | 17 s | |
| Power panel PWR1 | Muse Spark 1.3 | PASS: 8 breakers, ratings unreadable | 9 s | |
| Power panel PWR2 | Muse Spark Open | FAIL: 0 breakers; its reasoning treated breaker counting as possibly sensitive | 10 s | Panel photos go to **Spark 1.3**, not Spark Open |
| Power panel PWR2 | Muse Spark 1.3 | PASS: 8 breakers, ratings unreadable | 7 s | |
| Survey Lead from canned round-1 findings | Muse Wonder 1.0 | PASS: valid Lead JSON every run; respected the forced R11 objection, carried both questions, changed no verdict | 16-21 s default, **8-11 s at `reasoning.effort: low`**, 6-7 s minimal | Use `low`; 20 s timeout and Spark 1.3 fallback stay |

## Findings that change the build

- Breaker ratings are not legible in phone photos even before blurring (paper labels also cover parts of the
  breakers). The model gives the count and positions; the engineer confirms ratings and free breakers in the layout
  step (already required by the spec, "confirmed breakers"). R11 runs on confirmed values only.
- Spark Open needs a large `max_tokens` (12,000 here): with 3,000 its reasoning used the budget and the reply was empty.
- The Lead used `placement.target: "reserved"` to mean "on hold". The round prompt must define `reserved` as a new
  rack position and add a separate way to say "no placement yet".
