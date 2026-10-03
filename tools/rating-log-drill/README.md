# Rating-log drill — story 6.03, SD-08

A refund lands, then the dispute rating fails. The buyer must keep the credit,
and the failure must be logged so that it can be reconciled from the log alone:
dispute id, job id, payer and amount.

`drill.py` runs the backend's real `dispute_svc.uphold` on its in-memory store,
with a real payer key and a real signed dispute. Only the two chain calls are
replaced. The refund transfer answers `SUCCESS`, and the rating submission
answers `FAILED`, raises as a dropped RPC connection would, or is refused at
simulation, raised exactly as the client raises it before signing. Nothing is
signed or sent to any network, so it needs no testnet fixtures, no Postgres and
no key.

```sh
DRILL_BACKEND=/path/to/Orizon-Agents-BE-Stellar \
  /path/to/Orizon-Agents-BE-Stellar/.venv/Scripts/python drill.py
```

Each check prints PASS, FAIL, XFAIL or XPASS. It exits 1 on any FAIL, and also
on any XPASS, because an XPASS means the defect is fixed and its pin must come
off. Two checks were pinned this way, and both pins are now off: `the error line
carries the amount` (D-075) and `a rating refused at simulation is reported as
nothing landed` (D-076).

Results:
- Backend `08efeda`, 2026-09-26: 24 pass and 4 XFAIL (D-075 once per failure mode,
  D-076 once).
- Backend `6da6da7`, 2026-10-01: 28 pass, nothing pinned, exit 0. Both defects are
  fixed there.
