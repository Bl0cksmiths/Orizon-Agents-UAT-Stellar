"""Story 6.03e on testnet: what an upheld dispute costs the agent, and what the next plan sees.

A backend checkout run locally (uvicorn) on a real Postgres, pointed at the drill's own
ReputationLedger and test asset (setup_testnet.py). Every rating and every credit is a real
testnet transaction signed by the drill's settler, so nothing of the deployment's is touched.

    python drill.py run      the whole story, printed as PASS / FAIL / XFAIL / XPASS
    python drill.py serve    just the backend on the drill's ledger, for browser.spec.ts

Environment: DRILL_STATE (the directory setup_testnet.py wrote), DRILL_BACKEND (a backend
checkout), DRILL_DSN (a Postgres the drill may write to), DRILL_PYTHON (the backend's
interpreter), DRILL_TTL (the backend's reputation read TTL, default 15 s). REQUESTS_CA_BUNDLE
and SSL_CERT_FILE are passed through for a machine whose TLS is intercepted.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

STATE = Path(os.environ["DRILL_STATE"]).resolve()
FIX = json.loads((STATE / "rc-testnet.json").read_text())
BACKEND = Path(os.environ["DRILL_BACKEND"]).resolve()
DSN = os.environ["DRILL_DSN"]
PYTHON = os.environ.get("DRILL_PYTHON", sys.executable)
TTL = float(os.environ.get("DRILL_TTL", "15"))
LOGS = STATE / "logs"
PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"
# The calculator kit's research step: a kit plan needs no LLM key, and it stamps this agent.
AGENT = "agt_09l5"
INTENT = "Build me a calculator app"
API_KEY = os.environ.get("DRILL_API_KEY") or "rc-" + secrets.token_hex(8)

ENV = {
    "DATABASE_URL": DSN,
    "REPUTATION_ENABLED": "true",
    "REPUTATION_READ_TTL_SECONDS": str(TTL),
    "STELLAR_NETWORK": "testnet",
    "STELLAR_RPC_URL": "https://soroban-testnet.stellar.org",
    "STELLAR_NETWORK_PASSPHRASE": "Test SDF Network ; September 2015",
    "STELLAR_REPUTATION_LEDGER": FIX["reputation_ledger"],
    "STELLAR_ASSET_SAC": FIX["asset_sac"],
    "STELLAR_SIGNING_KEY": FIX["settler"]["secret"],
    "STELLAR_ADMIN_ADDRESS": FIX["settler"]["public"],
    "STELLAR_AGENT_REGISTRY": "",
    "STELLAR_PAYMENT_ESCROW": "CBJPTMAPMGODGZCZ2IMEQSRUX3WGUXNMKDTNN2KMJ3NFGYZ5OJ5525PI",
    "STELLAR_ATTESTATION_REGISTRY": "CBYUZKOET43UXTBXZUJIBBJW5ODGD2J2AZVVXCR3QONGOCAHOXQQHEGK",
    "DISPUTE_REFUNDS_ENABLED": "true",
    "API_KEY": API_KEY,
    "PYTHONIOENCODING": "utf-8",
    **{k: os.environ[k] for k in ("REQUESTS_CA_BUNDLE", "SSL_CERT_FILE") if k in os.environ},
}
os.environ.update(ENV)
sys.path.insert(0, str(BACKEND))

# (name, verdict, detail); verdict is PASS, FAIL, XFAIL or XPASS.
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", *, defect: str | None = None) -> bool:
    """Record one assertion. One pinned to an open defect reads XFAIL while the defect stands
    and XPASS — a failure of the drill — once it is fixed, so the pin must come off."""
    if defect is None:
        verdict = "PASS" if ok else "FAIL"
    else:
        verdict = "XPASS" if ok else "XFAIL"
        detail = f"{defect}{' — ' + detail if detail else ''}"
    results.append((name, verdict, detail))
    print(f"  [{verdict}] {name}{' — ' + detail if detail else ''}", flush=True)
    return ok


def http(method: str, path: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict]:
    """One JSON request to the drill's backend; an error status is an answer, not an exception."""
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


class Server:
    """The backend as its own process, as a deployment runs it — separate from the uphold script's."""

    def __init__(self) -> None:
        LOGS.mkdir(parents=True, exist_ok=True)
        self._log = (LOGS / "server.log").open("w", encoding="utf-8")
        keep = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "PATH", "TEMP", "TMP", "USERPROFILE", "HOME"}}
        self.proc = subprocess.Popen(
            [PYTHON, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--workers", "1"],
            cwd=BACKEND, env={**keep, **ENV}, stdout=self._log, stderr=subprocess.STDOUT,
        )
        deadline = time.time() + 420
        while time.time() < deadline:
            try:
                if http("GET", "/health")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.5)
        self.stop()
        raise RuntimeError(f"the backend did not come up; see {LOGS / 'server.log'}")

    def stop(self) -> None:
        self.proc.kill()
        self.proc.wait(timeout=30)
        self._log.close()


def on_store(use):
    """Run `use(store)` against the Postgres dispute store, as a separate process would."""
    import asyncio  # noqa: PLC0415

    from app.services import dispute_store  # noqa: PLC0415

    async def run():
        store = dispute_store.PostgresDisputeStore(DSN)
        try:
            return await use(store)
        finally:
            await store.close()

    return asyncio.run(run())


REP_FIELDS = ("smoothed_bps", "avg_bps", "count", "disputed", "dispute_rate_bps", "weight", "source", "degraded")


def rep() -> dict:
    """The agent's reputation as GET /api/stellar/reputation/{agent_id} answers it."""
    status, body = http("GET", f"/api/stellar/reputation/{AGENT}")
    if status != 200:
        raise RuntimeError(f"reputation read answered {status}: {body}")
    return {k: body[k] for k in REP_FIELDS}


def plan_stamp() -> dict:
    """What a freshly decomposed plan stamps on the agent's step — the plan card's numbers."""
    status, body = http("POST", "/api/orchestrator/decompose", {"intent": INTENT})
    if status != 200:
        raise RuntimeError(f"decompose answered {status}: {body}")
    step = next(s for s in body["steps"] if s["agent_id"] == AGENT)
    return {k: v for k, v in step.items() if k.startswith("rep")}


# The step is quoted at STEP_PRICE and the workflow settles SETTLED_TOTAL, so a rating weighted
# by the settled total instead of the step's quoted price shows up as a different number.
STEP_PRICE = 0.1
SETTLED_TOTAL = 0.35


def seed_workflow(label: str, payer: str, record: dict) -> str:
    """A settled two-step workflow whose step 0 is AGENT's, and the settler's own rating of that
    step on-chain (kind "auto", as the settlement path writes it). Returns the sealed job id."""
    from app.services import dispute_store as ds  # noqa: PLC0415
    from app.services import reputation_svc  # noqa: PLC0415
    from app.stellar import client as sc  # noqa: PLC0415

    job = secrets.token_bytes(16)
    weight = reputation_svc.rating_weight_stroops(STEP_PRICE)
    raw = sc.submit_rating(AGENT, job, 90, weight, payer, "auto")
    check(f"{label}: the settler's own rating of the step lands", raw.get("status") == "SUCCESS", raw.get("hash", ""))
    record.setdefault("settler_ratings", {})[label] = {"tx": raw.get("hash"), "job_id": job.hex(), "rating": 90, "weight": weight}
    now = time.time()
    settlement = ds.SettlementRecord(
        task_id=f"rc-{label}-{secrets.token_hex(3)}", payer=payer, auth_id_hex=secrets.token_hex(16), job_id_hex=job.hex(),
        charge_tx=secrets.token_hex(32), proof_tx=secrets.token_hex(32), settled_usdc=SETTLED_TOTAL,
        steps=(
            ds.SettlementStep(0, AGENT, "Researcher", STEP_PRICE, True, "Found three sources"),
            ds.SettlementStep(1, "agt_05x7", "SEO brief", SETTLED_TOTAL - STEP_PRICE, True, "Wrote the brief"),
        ),
        settled_at=now, window_closes_at=now + 86_400.0,
    )
    on_store(lambda store: store.record_settlement(settlement))
    return job.hex()


def open_dispute(buyer, job: str) -> dict:
    """Dispute step 0 as the buyer: challenge, sign the exact message, open."""
    import base64  # noqa: PLC0415

    status, challenge = http("POST", "/api/disputes/challenge", {"job_id_hex": job, "step_index": 0})
    if status != 200:
        raise RuntimeError(f"challenge answered {status}: {challenge}")
    signature = base64.b64encode(buyer.sign(challenge["message"].encode("utf-8"))).decode("ascii")
    status, dispute = http("POST", "/api/disputes", {
        "job_id_hex": job, "step_index": 0, "reason": "The research step returned nothing usable.",
        "payer": buyer.public_key, "nonce": challenge["nonce"], "signature_b64": signature,
    })
    if status != 200:
        raise RuntimeError(f"opening the dispute answered {status}: {dispute}")
    return dispute


def decode_rating(tx_hash: str) -> dict:
    """A rating transaction's submit arguments read back off the chain — what Stellar Expert shows.

    `ReputationLedger.submit(caller, agent_id, job_id, rating_0_to_100, weight, payer, kind)`.
    """
    from stellar_sdk import SorobanServer, scval, xdr  # noqa: PLC0415

    got = SorobanServer(ENV["STELLAR_RPC_URL"]).get_transaction(tx_hash)
    call = xdr.TransactionEnvelope.from_xdr(got.envelope_xdr).v1.tx.operations[0].body.invoke_host_function_op.host_function.invoke_contract
    caller, agent, job, rating, weight, payer, kind = call.args
    return {
        "status": got.status.value,
        "ledger_close": got.create_at,
        "function": call.function_name.sc_symbol.decode(),
        "caller": scval.from_address(caller).address,
        "agent_id": scval.from_symbol(agent),
        "job_id": scval.from_bytes(job).hex(),
        "rating": scval.from_uint32(rating),
        "weight": scval.from_int128(weight),
        "payer": scval.from_address(payer).address,
        "kind": scval.from_symbol(kind),
        "explorer": f"https://stellar.expert/explorer/testnet/tx/{tx_hash}",
    }


def serve() -> None:
    """The backend alone, in this process, on the drill's ledger and asset."""
    import uvicorn  # noqa: PLC0415

    os.chdir(BACKEND)
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, workers=1)


if __name__ == "__main__":
    {"serve": serve}[sys.argv[1]]()
