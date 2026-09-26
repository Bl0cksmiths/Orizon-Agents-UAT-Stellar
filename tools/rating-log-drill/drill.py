"""SD-08 drill (story 6.03): a refund lands, then the dispute rating fails.

Runs the backend's real dispute_svc.uphold on its in-memory store. Only the two chain
calls are replaced: the refund transfer answers SUCCESS and the rating submission
answers FAILED. Nothing is signed or sent to any network.

    python drill.py      every check, printed as PASS / FAIL / XFAIL / XPASS

Environment: DRILL_BACKEND, a backend checkout; run it with that checkout's virtualenv.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import sys
import time
from pathlib import Path

BACKEND = Path(os.environ["DRILL_BACKEND"]).resolve()
os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("OPENAI_API_KEY", "sk-drill")
sys.path.insert(0, str(BACKEND))

import app.stellar.client as sc
from app.config import settings
from app.services import dispute_store, dispute_svc, refund_svc
from app.services.dispute_store import SettlementRecord, SettlementStep
from app.services.dispute_svc import dispute_message
from stellar_sdk import Keypair

settings.dispute_refunds_enabled = True
settings.reputation_enabled = True
settings.stellar_reputation_ledger = "CDRILLLEDGER"
settings.stellar_signing_key = Keypair.random().secret
settings.stellar_asset_sac = "CSAC" + "7Z2Q" * 12

PRICE = 0.05
REFUND_TX = "tx_credit_landed"

# (name, verdict, detail); verdict is PASS, FAIL, XFAIL or XPASS.
results: list[tuple[str, str, str]] = []
records: list[logging.LogRecord] = []


def check(name: str, ok: bool, detail: str = "", *, defect: str | None = None) -> None:
    """Record one assertion. One pinned to an open defect reads XFAIL while the defect stands
    and XPASS — a failure of the drill — once it is fixed, so the pin must come off."""
    if defect:
        verdict = "XPASS" if ok else "XFAIL"
        detail = f"{defect}: {detail}"
    else:
        verdict = "PASS" if ok else "FAIL"
    results.append((name, verdict, detail))


class Capture(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if record.name.startswith("app."):
            records.append(record)


async def execute_refund(buyer: str, amount_usdc: float) -> dict:
    return {"status": "SUCCESS", "hash": REFUND_TX, "ledger": 4242}


async def submit_rating_async(agent_id, job_id, rating, weight, payer, kind) -> dict:
    """The rating fails in one of the ways the network can fail it: answered FAILED, the call
    raising as a dropped RPC connection does, or refused at simulation, raised as the client
    raises it before anything is signed (app/stellar/client.py, prepare failed)."""
    if RATING_FAILURE == "raise":
        raise ConnectionError("rpc connection dropped")
    if RATING_FAILURE == "refuse":
        raise RuntimeError("prepare failed: HostError: Error(Value, InvalidInput)")
    return {"status": "FAILED", "hash": "tx_rating_failed"}


RATING_FAILURE = "answer"


async def upheld_with_a_failed_rating():
    """Settle one step, open a signed dispute on it, and uphold it."""
    payer = Keypair.random()
    job = os.urandom(16).hex()
    now = time.time()
    store = dispute_store.get_dispute_store()
    await store.record_settlement(SettlementRecord(
        task_id="tsk_sd08", payer=payer.public_key, auth_id_hex="ab" * 16, job_id_hex=job,
        charge_tx="tx_charge", proof_tx="tx_proof", settled_usdc=PRICE,
        steps=(SettlementStep(step_index=0, agent_id="agt_sd08", agent_name="SD08",
                              price_usdc=PRICE, delivered=True),),
        settled_at=now, window_closes_at=now + 3600))
    nonce, _ = await dispute_svc.issue_dispute_challenge(job, 0)
    signature = base64.b64encode(payer.sign(dispute_message(job, 0, nonce).encode())).decode()
    opened = await dispute_svc.open_dispute(
        job_id_hex=job, step_index=0, reason="the file was empty", payer=payer.public_key,
        nonce=nonce, signature_b64=signature)
    records.clear()
    return opened, await dispute_svc.uphold(opened.id)


def sd08_credit_kept(upheld) -> None:
    check("SD-08 the dispute stays credited", upheld.status == "credited", upheld.status)
    check("SD-08 the refund hash is kept", upheld.refund_tx == REFUND_TX, str(upheld.refund_tx))
    check("SD-08 the credited amount is kept", upheld.credited_usdc == PRICE, str(upheld.credited_usdc))
    check("SD-08 no rating hash is claimed", upheld.rating_tx is None, str(upheld.rating_tx))


def sd08_failure_logged(opened) -> None:
    """The rating's failure line must let an operator reconcile the credit from it alone."""
    errors = [r.getMessage() for r in records
              if r.name == "app.services.dispute_svc" and r.levelno >= logging.ERROR]
    check("SD-08 the rating failure is logged as an error", len(errors) == 1, f"{len(errors)} lines")
    line = errors[0] if errors else ""
    for field, value in (("dispute id", opened.id), ("job id", opened.job_id_hex),
                         ("payer", opened.payer)):
        check(f"SD-08 the error line carries the {field}", value in line, line)
    check("SD-08 the error line carries the amount", str(PRICE) in line,
          line, defect="D-075")


def refused_before_submission_is_failed() -> None:
    """Nothing was signed or sent, so the outcome must say nothing landed, not that it may still."""
    lines = " | ".join(r.getMessage() for r in records if r.levelno >= logging.ERROR)
    check("D-076 a rating refused at simulation is reported as nothing landed",
          "nothing landed" in lines and "MAY HAVE LANDED" not in lines, lines[:200], defect="D-076")


async def main() -> int:
    refund_svc.execute_refund = execute_refund
    sc.submit_rating_async = submit_rating_async
    logging.getLogger().addHandler(Capture())
    logging.getLogger().setLevel(logging.INFO)

    global RATING_FAILURE
    for RATING_FAILURE in ("answer", "raise", "refuse"):
        opened, upheld = await upheld_with_a_failed_rating()
        results.append((f"-- rating failure: {RATING_FAILURE}", "", ""))
        sd08_credit_kept(upheld)
        sd08_failure_logged(opened)
        if RATING_FAILURE == "refuse":
            refused_before_submission_is_failed()

    for name, verdict, detail in results:
        print(f"{verdict:5}  {name}  {detail}")
    return 1 if any(v in {"FAIL", "XPASS"} for _, v, _ in results) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
