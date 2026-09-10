# Wallet × browser registration matrix (1.05)

**This matrix is executed by hand. Nothing in the automated suite fills it in.**

Each cell requires a real wallet installed in a real browser and a human
approving a signature in that wallet's own UI. Playwright cannot install these
extensions or drive their popups, and two of the wallets are not extensions at
all — Albedo is a web redirect, LOBSTR is mobile/WalletConnect. Per the friction
log's own instructions the contributor must be **external, non-Blocksmiths** and
must work **unaided**, with an observer recording friction live.

Automating any part of WM-03 or WM-04 would fabricate the evidence the exercise
exists to gather. WM-01 (the picker offers each allowlisted wallet) is automated
in `tests/wallet-picker.spec.ts`; everything below is not.

## Before you start

- **Target must be testnet.** This programme is testnet-only and the current
  deployment reports **mainnet** (defect D-001). Do not run this matrix against
  a mainnet target — every cell ends in a real signed transaction.
- Set `UAT_BASE_URL` to the testnet deployment and confirm
  `GET /api/stellar/network` reports `testnet` before the first cell.
- Each cell needs a **funded** testnet account, or the run stops at
  `owner_account_unfunded`.
- Each cell needs a **fresh agent id** — ids are single-use, and a repeat gives
  `id_taken`.

## The matrix

Record one row per cell. `—` means not attempted; say why.

| # | Wallet | Browser | Connected? | Network read correctly? | Signed? | Agent listed? | Friction logged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Freighter | Chrome | | | | | |
| 2 | Freighter | Firefox | | | | | |
| 3 | Freighter | Safari (desktop) | | | | | |
| 4 | Freighter | Safari (mobile) | | | | | |
| 5 | Freighter | Chrome (mobile) | | | | | |
| 6 | xBull | Chrome | | | | | |
| 7 | xBull | Firefox | | | | | |
| 8 | xBull | Safari (desktop) | | | | | |
| 9 | xBull | Safari (mobile) | | | | | |
| 10 | xBull | Chrome (mobile) | | | | | |
| 11 | Albedo | Chrome | | | | | |
| 12 | Albedo | Firefox | | | | | |
| 13 | Albedo | Safari (desktop) | | | | | |
| 14 | Albedo | Safari (mobile) | | | | | |
| 15 | Albedo | Chrome (mobile) | | | | | |
| 16 | LOBSTR | Chrome | | | | | |
| 17 | LOBSTR | Firefox | | | | | |
| 18 | LOBSTR | Safari (desktop) | | | | | |
| 19 | LOBSTR | Safari (mobile) | | | | | |
| 20 | LOBSTR | Chrome (mobile) | | | | | |
| 21 | Hana | Chrome | | | | | |
| 22 | Hana | Firefox | | | | | |
| 23 | Hana | Safari (desktop) | | | | | |
| 24 | Hana | Safari (mobile) | | | | | |
| 25 | Hana | Chrome (mobile) | | | | | |

**Rabet is deliberately absent.** The build allowlists it but SOW §3.3 does not
name it (defect D-016). Add a sixth wallet block only if that is resolved in
Rabet's favour.

## Known issues that will affect specific cells

Record these when they occur rather than treating them as tester error.

**Albedo and LOBSTR cannot report their network (D-015).** Neither implements
`getNetwork()`, so the app's wrong-network guard cannot fire for them. On those
ten cells, "network read correctly?" cannot be answered by the app — the tester
must confirm the wallet's own network manually. A wrong-network wallet on those
two will sign and fail downstream rather than being caught up front. **Do not
mark those cells a clean pass on that column.**

**The picker cannot be dismissed by keyboard (D-017).** No Escape handler, and
the close control has no accessible name. Any tester working keyboard-only will
be stuck at the very first step of every cell.

**The picker labels Hana as "Hana Wallet" (D-018).** The app calls it "Hana"
elsewhere. Not a failure — just do not record it as a mismatch.

## Recording friction

Every hesitation, question, confusion or error goes in
`docs/evidence/1.07-friction-log.md` in the backend repository, with a severity,
**during** the run. Coaching a step is a finding, not a pass — if the
contributor had to be told what to do, the cell is not clean, even if the
transaction landed.

## Per-wallet failure paths (story 6.01)

The matrix above records whether registration *succeeds*. 6.01 also requires
each failure path to be exercised per wallet, because wallets differ in exactly
these behaviours — which is why `lib/wallet-errors.ts` exists at all.

For every cell, also record:

| failure path | what to check |
| --- | --- |
| Reject the signature | The form retains **every** value and shows a neutral message, not an error. Expected copy: "Signing cancelled — your details are saved." |
| Lock the wallet mid-flow | The failure is classified and readable, not a raw exception. |
| Point the wallet at mainnet | The user is told to switch to testnet. **Albedo and LOBSTR cannot satisfy this (D-015)** — record what actually happens instead. |
| Disconnect mid-submit | The submit-interrupted path warns that the transaction may still have landed and does not auto-retry. |

The rejection path is the one to watch most closely. It is correct in source
and it is the single most common way an operator is lost — but it is **not
covered by any automated test** (see the 6.01 coverage map in
`test-plan.md`), so this manual pass is its only verification.

Record the wallet's own wording for each, not just pass/fail: the differences
between wallets are the finding, and they feed story 5.03's integration guide.
