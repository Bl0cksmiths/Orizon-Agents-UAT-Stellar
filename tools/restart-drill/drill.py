"""Restart drill for story 6.03d — durability tested by restarting, not by reasoning.

Runs a real backend process (uvicorn) against a real Postgres, kills it, starts
it again, and compares what the API answers on each side of the restart.
Settlements are seeded through the backend's own store, as the settlement path
writes them; disputes are opened over HTTP with a real payer signature.

    DRILL_BACKEND=<backend checkout> DRILL_DSN=postgresql://... python drill.py [scenario ...]

Run it with the backend's own interpreter (its virtualenv has uvicorn, asyncpg
and stellar_sdk). See README.md beside this file.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

BACKEND = Path(os.environ["DRILL_BACKEND"]).resolve()
DSN = os.environ["DRILL_DSN"]
PORT = int(os.environ.get("DRILL_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
LOGS = Path(os.environ.get("DRILL_LOGS", "logs")).resolve()
PYTHON = os.environ.get("DRILL_PYTHON", sys.executable)

# (name, verdict, detail); verdict is PASS, FAIL, XFAIL or XPASS.
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", *, defect: str | None = None) -> bool:
    """Record one assertion. A check pinned to an open defect is expected to fail:
    it reads XFAIL while the defect stands and XPASS — a failure of the drill —
    the moment it is fixed, so the pin has to be removed rather than forgotten."""
    if defect is None:
        verdict = "PASS" if ok else "FAIL"
    else:
        verdict = "XPASS" if ok else "XFAIL"
        detail = f"{defect}{' — ' + detail if detail else ''}"
    results.append((name, verdict, detail))
    print(f"  [{verdict}] {name}{' — ' + detail if detail else ''}", flush=True)
    return ok


def http(method: str, path: str, body: dict | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    """One JSON request to the drill's backend; an error status is an answer, not an exception."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def backend_env(*, durable: bool, task_auth: bool = False) -> dict[str, str]:
    """A clean environment: nothing from the operator's shell or a .env reaches the backend."""
    keep = {"SYSTEMROOT", "PATH", "TEMP", "TMP", "USERPROFILE", "HOME"}
    env = {k: v for k, v in os.environ.items() if k.upper() in keep}
    env.update(
        {
            "DATABASE_URL": DSN if durable else "",
            "TASK_AUTH_REQUIRED": "true" if task_auth else "false",
            "STELLAR_AGENT_REGISTRY": "",
            "REPUTATION_ENABLED": "false",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    return env


class Backend:
    """One backend process, from start to a hard kill."""

    def __init__(self, label: str, env: dict[str, str]) -> None:
        LOGS.mkdir(parents=True, exist_ok=True)
        self.log_path = LOGS / f"{label}.log"
        self._log = self.log_path.open("w", encoding="utf-8")
        self.proc = subprocess.Popen(
            [PYTHON, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--workers", "1"],
            cwd=BACKEND,
            env=env,
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        # A cold first import on this machine has taken over a minute.
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                if http("GET", "/health")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.3)
        self.kill()
        raise RuntimeError(f"backend {label} did not come up; see {self.log_path}")

    def kill(self) -> None:
        """What a spun-down instance gets: no shutdown hook, nothing flushed on the way out."""
        self.proc.kill()
        self.proc.wait(timeout=30)
        self._log.close()

    def log(self) -> str:
        if not self._log.closed:
            self._log.flush()
        return self.log_path.read_text(encoding="utf-8", errors="replace")


def dispute_store():
    """The backend's own store module, imported with the drill's DATABASE_URL in force."""
    os.environ["DATABASE_URL"] = DSN
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    from app.services import dispute_store as module  # noqa: PLC0415

    return module


def on_store(use):
    """Run `use(store)` against a Postgres store of its own, as a separate process would."""

    async def _run():
        store = dispute_store().PostgresDisputeStore(DSN)
        try:
            return await use(store)
        finally:
            await store.close()

    return asyncio.run(_run())


def seed_settlement(task_id: str, payer: str) -> str:
    """Record one settled two-step workflow the way the settlement path does; returns its job id."""
    ds = dispute_store()
    job = secrets.token_hex(16)
    now = time.time()
    record = ds.SettlementRecord(
        task_id=task_id,
        payer=payer,
        auth_id_hex=secrets.token_hex(16),
        job_id_hex=job,
        charge_tx=secrets.token_hex(32),
        proof_tx=secrets.token_hex(32),
        settled_usdc=0.35,
        steps=(
            ds.SettlementStep(0, "research-agent", "Researcher", 0.1, True, "Found three sources"),
            ds.SettlementStep(1, "code-agent", "Coder", 0.25, True, "Built a landing page"),
        ),
        settled_at=now,
        window_closes_at=now + 86_400.0,
    )
    on_store(lambda store: store.record_settlement(record))
    return job


SCENARIOS: dict[str, Callable[[], None]] = {}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(SCENARIOS):
        SCENARIOS[name]()
    failed = [r for r in results if r[1] in {"FAIL", "XPASS"}]
    expected = [r for r in results if r[1] == "XFAIL"]
    print(f"\n{len(results) - len(failed) - len(expected)} passed, {len(expected)} expected failures, {len(failed)} failed")
    sys.exit(1 if failed else 0)
