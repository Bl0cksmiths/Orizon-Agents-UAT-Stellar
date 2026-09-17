# Dispatch plan — story 6.02, reputation floor and routing boundaries

Work is split so that **no two streams edit the same file**. Ownership is the
partition; dependency order and size only decide when each starts.

| stream | repo | owns (may edit) | criteria |
| --- | --- | --- | --- |
| A — lead | UAT | `docs/uat/*`, `package.json`, `package-lock.json`, `playwright.config.ts`, `.env.uat.example`, `ci/*` | — |
| B — boundaries | backend | `tests/test_floor_boundaries.py` | RF-01, RF-02, RF-03, RF-06, RF-07, RF-08, RF-16 |
| C — disclosure | backend | `tests/test_floor_disclosure.py` | RF-04, RF-05, RF-12, RF-13 |
| D — visibility | backend | `tests/test_floor_visibility.py` | RF-09, RF-10, RF-11, RF-15 |
| E — plan card | UAT | `tests/reputation-floor.spec.ts` | RF-14, RF-17 |

**No stream touches production code in this phase.** Streams B–D add test files
only; a criterion that fails is recorded as a defect and fixed in phase 2, where
fixes are dispatched by *code area* so that `orchestrator_svc.py` and
`config.py` each have exactly one author.

## Concurrency is sized to the machine, not to the work

The authoring machine has 3.9 GB of RAM with ~0.4 GB free, and defect D-002
records the previous programme being unable to install dependencies at all on
it. Six concurrent agents each running a test suite would thrash it and produce
failures that say nothing about the product. Streams B, C and D therefore run
concurrently (pytest is cheap and they share one virtualenv), and stream E —
which drives a real browser against a live deployment — runs after them.
