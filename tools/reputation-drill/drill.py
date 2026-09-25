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


def serve() -> None:
    """The backend alone, in this process, on the drill's ledger and asset."""
    import uvicorn  # noqa: PLC0415

    os.chdir(BACKEND)
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, workers=1)


if __name__ == "__main__":
    {"serve": serve}[sys.argv[1]]()
