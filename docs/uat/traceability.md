# Traceability matrix

Every acceptance criterion in `test-plan.md` maps to the test that verifies it.
No cell is empty: a criterion is Covered, Added (written during this
programme), Blocked (with a defect id), or Not covered (with a stated reason).

**Verification status of the whole matrix:** every test below was authored and
statically checked, but **none has been executed** — see defect D-002. "Covered"
here means "a test exists that would fail if the behaviour broke", not "observed
passing".

## EV — registration evidence

| criterion | spec | status |
| --- | --- | --- |
| EV-01 | — | **Blocked** — D-001, needs a signed registration on a testnet target |
| EV-02 | — | **Blocked** — D-001 |
| EV-03 | — | **Blocked** — D-001; `verify_registration.py` needs a real tx hash |
| EV-04 | — | **Blocked** — D-001 |
| EV-05 | evidence.spec.ts | Covered — 4 tests, incl. live `/api/stellar/network` round-trip |
