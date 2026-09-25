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


def uphold(state: str) -> dict:
    """Uphold through the adjudication route, as the operator does: a real refund, a real rating."""
    dispute_id = open_dispute(state, settle(state))
    status, dispute = rc.http("POST", f"/api/disputes/{dispute_id}/uphold", headers={"X-API-Key": rc.API_KEY})
    rc.check(f"{state}: upheld, credited and rated", status == 200 and dispute.get("status") == "credited"
             and dispute.get("rating_confirmed") is True, f"{status} {dispute.get('status')}")
    seed["tx"][state] = {"refund": dispute["refund_tx"], "rating": dispute["rating_tx"], "credited_usdc": dispute["credited_usdc"]}
    return dispute


def reject(state: str) -> dict:
    """Reject through the adjudication route, after proving it will not reject without a reason."""
    dispute_id = open_dispute(state, settle(state))
    path, key = f"/api/disputes/{dispute_id}/reject", {"X-API-Key": rc.API_KEY}
    for label, body, code in (("no reason", {}, "validation_error"), ("a blank reason", {"note": " \t\n "}, "rejection_reason_required")):
        status, refused = rc.http("POST", path, body, headers=key)
        rc.check(f"{state}: a rejection with {label} is refused", status == 422 and refused.get("error", {}).get("code") == code,
                 f"{status} {refused.get('error', {}).get('code')}")
    status, still = rc.http("GET", f"/api/disputes/{dispute_id}")
    rc.check(f"{state}: the refused rejections left the dispute open", still.get("status") == "open", str(still.get("status")))
    status, dispute = rc.http("POST", path, {"note": REJECTION}, headers=key)
    rc.check(f"{state}: rejected with its reason", status == 200 and dispute.get("status") == "rejected"
             and dispute.get("rejection_reason") == REJECTION, f"{status} {dispute.get('status')}")
    return dispute


def transfer() -> str:
    """A real refund transfer, settler to payer, as `refund_svc.execute_refund` signs it."""
    import asyncio  # noqa: PLC0415

    from app.services import refund_svc  # noqa: PLC0415

    raw = asyncio.run(refund_svc.execute_refund(rc.FIX["buyer"]["public"], STEP_PRICE))
    if raw.get("status") != "SUCCESS":
        raise RuntimeError(f"the refund transfer did not land: {raw}")
    return raw["hash"]


def crediting(state: str) -> None:
    """A refund submitted and not yet confirmed: the record a transfer TIMEOUT leaves.

    The claim is taken as uphold takes it, the transfer is real, and the record is written as
    `dispute_svc.uphold` writes a TIMEOUT answer — `crediting`, with the hash.
    """
    dispute_id = open_dispute(state, settle(state))
    rc.on_store(lambda store: store.append_status(dispute_id, "upheld", expected_status="open"))
    claimed = rc.on_store(lambda store: store.claim_refund(dispute_id))
    rc.check(f"{state}: the refund is claimed", claimed is not None and claimed.status == "crediting")
    refund = transfer()
    rc.on_store(lambda store: store.append_status(dispute_id, "crediting", refund_tx=refund))
    seed["tx"][state] = {"refund": refund}


def paid(state: str) -> str:
    """A dispute whose real refund landed and was recorded as uphold's SUCCESS records it, with
    no rating yet — the moment between the two writes of one uphold. Returns the dispute id."""
    job = settle(state)
    dispute_id = open_dispute(state, job)
    rc.on_store(lambda store: store.append_status(dispute_id, "upheld", expected_status="open"))
    rc.on_store(lambda store: store.claim_refund(dispute_id))
    refund = transfer()
    rc.on_store(lambda store: store.append_status(dispute_id, "credited", refund_tx=refund, credited_usdc=STEP_PRICE))
    seed["tx"][state] = {"refund": refund, "credited_usdc": STEP_PRICE}
    return dispute_id


def dispute_rating(state: str) -> str:
    """A real dispute rating of agt_09l5 for this state's job, as `dispute_rating` submits it."""
    from app.services import dispute_rating as dr  # noqa: PLC0415
    from app.services import reputation_svc  # noqa: PLC0415
    from app.stellar import client as sc  # noqa: PLC0415

    derived = dr.dispute_job_id(bytes.fromhex(seed["jobs"][state]), 0)
    raw = sc.submit_rating(AGENT, derived, 10, reputation_svc.rating_weight_stroops(STEP_PRICE), rc.FIX["buyer"]["public"], "dispute")
    if raw.get("status") != "SUCCESS":
        raise RuntimeError(f"{state}: the dispute rating did not land: {raw}")
    seed["tx"][state]["rating"] = raw["hash"]
    return raw["hash"]


def rating_pending(state: str) -> None:
    """Credited, and the rating's answer timed out: recorded as the TIMEOUT branch records it."""
    dispute_id = paid(state)
    rating = dispute_rating(state)
    rc.on_store(lambda store: store.append_status(dispute_id, "credited", rating_tx=rating, rating_confirmed=False))


def rate_gap() -> None:
    """`python seed.py rate-gap`: land the "gap" dispute's rating and record it as uphold's SUCCESS
    does, while browser.spec.ts watches a receipt that last saw the refund alone."""
    seed.update(json.loads((rc.STATE / "ui-seed.json").read_text(encoding="utf-8")))
    rating = dispute_rating("gap")
    dispute_id = seed["disputes"]["gap"]
    rc.on_store(lambda store: store.append_status(dispute_id, "credited", rating_tx=rating, rating_confirmed=True))
    (rc.STATE / "ui-seed.json").write_text(json.dumps(seed, indent=2), encoding="utf-8")


def main() -> None:
    server = rc.Server()
    try:
        open_dispute("open", settle("open"))
        uphold("credited")
        reject("rejected")
        crediting("crediting")
        rating_pending("rating_pending")
        # Left open for browser.spec.ts to uphold while the payer watches the receipt.
        open_dispute("live", settle("live"))
        # Refunded with the rating still to come; `rate-gap` lands it while the page is open.
        paid("gap")
    finally:
        server.stop()
    seed["payer"] = rc.FIX["buyer"]["public"]
    # The drill backend's operator key, random per seed and local only: serve.py runs with it,
    # so browser.spec.ts can adjudicate as the operator does.
    seed["apiKey"] = rc.API_KEY
    (rc.STATE / "ui-seed.json").write_text(json.dumps(seed, indent=2), encoding="utf-8")
    failed = [r for r in rc.results if r[1] != "PASS"]
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    {"seed": main, "rate-gap": rate_gap}[sys.argv[1] if len(sys.argv) > 1 else "seed"]()
