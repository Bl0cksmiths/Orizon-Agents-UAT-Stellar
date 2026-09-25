"""Story 6.03f: every state of the dispute receipt, seeded on testnet for browser.spec.ts to read.

Built on the 6.03e drill (tools/reputation-drill): its own ReputationLedger, its test asset
UATUSD and its settler, which is that ledger's scorer. So every refund and every rating a
receipt links to is a real testnet transaction, and nothing of the deployment's is touched.
Settlements are recorded the way the settlement path records them; disputes are opened with
the payer's real signature; each state is then reached as the backend reaches it.

    python seed.py      writes $DRILL_STATE/ui-seed.json

Environment: as for tools/reputation-drill/drill.py (DRILL_STATE, DRILL_BACKEND, DRILL_DSN,
DRILL_PYTHON), which must have run setup_testnet.py first.
"""

from __future__ import annotations

import base64
import json
import secrets
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "reputation-drill"))
import drill as rc  # noqa: E402  (the 6.03e drill: fixtures, backend env, HTTP and store helpers)

AGENT = "agt_09l5"
STEP_PRICE = 0.1
SETTLED_TOTAL = 0.35
# The payer's words and the adjudicator's. Multi-byte on purpose, and distinctive, so the
# privacy checks can search a page, its source and every response for them.
REASON = "Research step 6.03f returned nothing usable — naïve sources, none cited 😀"
REJECTION = "Rejection 6.03f: the step delivered three cited sources, so the brief was met."

seed: dict = {"tasks": {}, "jobs": {}, "disputes": {}, "tokens": {}, "tx": {}}


def settle(state: str) -> str:
    """A settled two-step workflow paid by the drill's buyer, step 0 agt_09l5's; returns the job id."""
    from app.services import dispute_store as ds  # noqa: PLC0415

    task = f"ui-{state}-{secrets.token_hex(3)}"
    job = secrets.token_hex(16)
    now = time.time()
    record = ds.SettlementRecord(
        task_id=task, payer=rc.FIX["buyer"]["public"], auth_id_hex=secrets.token_hex(16), job_id_hex=job,
        charge_tx=secrets.token_hex(32), proof_tx=secrets.token_hex(32), settled_usdc=SETTLED_TOTAL,
        steps=(
            ds.SettlementStep(0, AGENT, "Researcher", STEP_PRICE, True, "Found three sources"),
            ds.SettlementStep(1, "agt_05x7", "SEO brief", SETTLED_TOTAL - STEP_PRICE, True, "Wrote the brief"),
        ),
        settled_at=now, window_closes_at=now + 86_400.0,
    )
    rc.on_store(lambda store: store.record_settlement(record))
    seed["tasks"][state], seed["jobs"][state] = task, job
    # The read token /api/orchestrator/execute would have issued for the task; serve.py
    # registers it, and the payer's tab holds it, as a tab that ran the task does.
    seed["tokens"][state] = secrets.token_urlsafe(24)
    return job


def open_dispute(state: str, job: str) -> str:
    """Dispute step 0 as the payer: challenge, sign the exact message, open. Returns the id."""
    from stellar_sdk import Keypair  # noqa: PLC0415

    payer = Keypair.from_secret(rc.FIX["buyer"]["secret"])
    status, challenge = rc.http("POST", "/api/disputes/challenge", {"job_id_hex": job, "step_index": 0})
    if status != 200:
        raise RuntimeError(f"{state}: challenge answered {status}: {challenge}")
    signature = base64.b64encode(payer.sign(challenge["message"].encode("utf-8"))).decode("ascii")
    status, dispute = rc.http("POST", "/api/disputes", {
        "job_id_hex": job, "step_index": 0, "reason": REASON, "payer": payer.public_key,
        "nonce": challenge["nonce"], "signature_b64": signature,
    })
    rc.check(f"{state}: the dispute opens", status == 200 and dispute.get("status") == "open", str(status))
    seed["disputes"][state] = dispute["id"]
    return dispute["id"]


def main() -> None:
    server = rc.Server()
    try:
        open_dispute("open", settle("open"))
    finally:
        server.stop()
    seed["payer"] = rc.FIX["buyer"]["public"]
    (rc.STATE / "ui-seed.json").write_text(json.dumps(seed, indent=2), encoding="utf-8")
    failed = [r for r in rc.results if r[1] != "PASS"]
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
