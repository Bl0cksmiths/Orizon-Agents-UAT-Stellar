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


# Multi-byte on purpose: a store that re-encodes a reason shows up as a changed byte.
REASON = "The signup form on the landing page never submits — naïve check, 😀 included"


def new_payer():
    from stellar_sdk import Keypair  # noqa: PLC0415

    return Keypair.random()


def open_dispute(payer, job: str, step: int, reason: str = REASON) -> tuple[int, dict]:
    """Challenge, sign the exact message with the payer's key, and open — as a wallet would."""
    status, challenge = http("POST", "/api/disputes/challenge", {"job_id_hex": job, "step_index": step})
    if status != 200:
        return status, challenge
    signature = base64.b64encode(payer.sign(challenge["message"].encode("utf-8"))).decode("ascii")
    return http(
        "POST",
        "/api/disputes",
        {
            "job_id_hex": job,
            "step_index": step,
            "reason": reason,
            "payer": payer.public_key,
            "nonce": challenge["nonce"],
            "signature_b64": signature,
        },
    )


def store_lines(log: str) -> list[str]:
    return [line for line in log.splitlines() if "store:" in line]


def du01() -> None:
    """DU-01 and DU-05: an open dispute, a hard restart, every field compared across it."""
    print("\n== du01: an open dispute survives a restart", flush=True)
    payer = new_payer()
    task = f"drill-du01-{secrets.token_hex(4)}"
    job = seed_settlement(task, payer.public_key)
    first = Backend("du01-before", backend_env(durable=True))
    status, opened = open_dispute(payer, job, 1)
    check("the dispute opens before the restart", status == 200 and opened.get("status") == "open", str(status))
    _, one_before = http("GET", f"/api/disputes/{opened['id']}")
    _, task_before = http("GET", f"/api/tasks/{task}/disputes")
    first.kill()

    second = Backend("du01-after", backend_env(durable=True))
    at_boot = store_lines(second.log())
    _, health = http("GET", "/health")
    check("the second process is a new one", health.get("uptime_seconds", 99) < 30, f"uptime {health.get('uptime_seconds')}s")
    status, one_after = http("GET", f"/api/disputes/{opened['id']}")
    _, task_after = http("GET", f"/api/tasks/{task}/disputes")
    after_first_read = store_lines(second.log())
    second.kill()

    check("GET /api/disputes/{id} answers 200 after the restart", status == 200, str(status))
    changed = {k: (one_before.get(k), one_after.get(k)) for k in one_before if one_before.get(k) != one_after.get(k)}
    check("the dispute is field-for-field identical", not changed, json.dumps(changed))
    for field in ("status", "reason", "charged_usdc", "creditable_usdc", "opened_at"):
        check(f"  {field} unchanged", one_after.get(field) == one_before.get(field), repr(one_after.get(field)))
    check("the reason survives byte for byte", one_after.get("reason") == REASON)
    check("the task listing's disputes are identical", task_after["disputes"] == task_before["disputes"])
    check("the closing time is the same", task_after["window_closes_at"] == task_before["window_closes_at"], str(task_after["window_closes_at"]))
    check("the settlement is identical", task_after["settlement"] == task_before["settlement"])
    check("DU-05 the boot log names the binding store as postgres", any("binding store: postgres" in l for l in at_boot))
    check("DU-05 the boot log names the dispute store", any("dispute store:" in l for l in at_boot), "logged only at first use", defect="D-063")
    check("DU-05 the dispute store names postgres by the first read", any("dispute store: postgres" in l for l in after_first_read))


def du01_control() -> None:
    """The control: restart onto the in-memory store and the same dispute must be gone.
    If this ever passes the durable checks, the drill is not measuring the store."""
    print("\n== du01-control: the in-memory fallback loses the dispute", flush=True)
    payer = new_payer()
    task = f"drill-control-{secrets.token_hex(4)}"
    job = seed_settlement(task, payer.public_key)
    first = Backend("control-before", backend_env(durable=True))
    status, opened = open_dispute(payer, job, 1)
    check("the dispute opens on Postgres", status == 200, str(status))
    first.kill()
    second = Backend("control-after", backend_env(durable=False))
    status, one = http("GET", f"/api/disputes/{opened['id']}")
    _, listing = http("GET", f"/api/tasks/{task}/disputes")
    lines = store_lines(second.log())
    second.kill()
    check("in memory, the dispute is unknown after the restart", status == 404, f"{status} {one.get('detail')}")
    check("in memory, the task has no settlement and no disputes", listing.get("settlement") is None and listing.get("disputes") == [])
    check("the log says the store is in memory", any("in-memory (DATABASE_URL is unset)" in l for l in lines))


def du02() -> None:
    """DU-02: a settlement recorded before a restart can still be disputed after it."""
    print("\n== du02: a settlement survives a restart and stays disputable", flush=True)
    payer = new_payer()
    task = f"drill-du02-{secrets.token_hex(4)}"
    job = seed_settlement(task, payer.public_key)
    first = Backend("du02-before", backend_env(durable=True))
    _, before = http("GET", f"/api/tasks/{task}/disputes")
    first.kill()
    second = Backend("du02-after", backend_env(durable=True))
    _, after = http("GET", f"/api/tasks/{task}/disputes")
    status, opened = open_dispute(payer, job, 0)
    second.kill()
    check("the settlement is identical after the restart", after["settlement"] is not None and after["settlement"] == before["settlement"])
    check("the closing time is the same", after["window_closes_at"] == before["window_closes_at"])
    check("a dispute raised after the restart is accepted", status == 200 and opened.get("status") == "open", f"{status} {opened.get('status') or opened.get('detail')}")
    check("its amounts come from the pre-restart settlement", opened.get("charged_usdc") == 0.1, str(opened.get("charged_usdc")))


def token_gap() -> None:
    """The known gap: with TASK_AUTH_REQUIRED on, tokens die with the process — disputes must not."""
    print("\n== token-gap: TASK_AUTH_REQUIRED=true across a restart", flush=True)
    payer = new_payer()
    task = f"drill-token-{secrets.token_hex(4)}"
    job = seed_settlement(task, payer.public_key)
    first = Backend("token-before", backend_env(durable=True, task_auth=True))
    status, opened = open_dispute(payer, job, 1)
    check("a dispute opens with no task token", status == 200, str(status))
    first.kill()
    second = Backend("token-after", backend_env(durable=True, task_auth=True))
    status, listing = http("GET", f"/api/tasks/{task}/disputes", headers={"X-Task-Token": "held-from-before-the-restart"})
    check("the per-task listing answers as if the task were unknown", status == 404, f"{status} {listing.get('detail')}")
    status, one = http("GET", f"/api/disputes/{opened['id']}")
    check("GET /api/disputes/{id} still answers, and the dispute is open", status == 200 and one.get("status") == "open", str(status))
    status, again = open_dispute(payer, seed_settlement(f"{task}-b", payer.public_key), 1)
    check("a new dispute can be raised after the restart with no token", status == 200 and again.get("status") == "open", str(status))
    second.kill()


def uphold_env() -> dict[str, str]:
    """What the operator's machine needs to run the uphold script live: the refund switch,
    a settler key (a throwaway one — nothing is signed), and a RPC that answers nothing."""
    env = backend_env(durable=True)
    env.update(
        {
            "DISPUTE_REFUNDS_ENABLED": "true",
            "API_KEY": "drill-" + secrets.token_hex(8),
            "STELLAR_SIGNING_KEY": new_payer().secret,
            "STELLAR_NETWORK": "testnet",
            "STELLAR_NETWORK_PASSPHRASE": "Test SDF Network ; September 2015",
            "STELLAR_RPC_URL": "http://127.0.0.1:9",
            "STELLAR_ASSET_SAC": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            "STELLAR_REPUTATION_LEDGER": "CDCSOBEVZUPQZV5GV4D6KYHZCLNGW2KXY74RUHSZ3EZUXF34DPW422ZT",
            "REPUTATION_ENABLED": "true",
        }
    )
    return env


def run_uphold(dispute_id: str, env: dict[str, str], calls: Path, tx_hash: str, label: str) -> tuple[int, str]:
    """One run of the real script through run_uphold.py; returns its exit code and stdout."""
    env = {**env, "DRILL_BACKEND": str(BACKEND), "DRILL_TRANSFER_CALLS": str(calls), "DRILL_TX_HASH": tx_hash}
    done = subprocess.run(
        [PYTHON, str(Path(__file__).with_name("run_uphold.py")), "--dispute-id", dispute_id],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    (LOGS / f"{label}.stdout.txt").write_text(done.stdout, encoding="utf-8")
    (LOGS / f"{label}.stderr.txt").write_text(done.stderr, encoding="utf-8")
    return done.returncode, done.stdout


def transfers_signed(calls: Path) -> int:
    return len(calls.read_text(encoding="utf-8").splitlines()) if calls.exists() else 0


def reconciliation_queue() -> list[str]:
    """The store's list_refund_claims(): every payout still in flight, oldest first."""
    return [claim.dispute_id for claim in on_store(lambda store: store.list_refund_claims())]


def du04() -> None:
    """DU-03 and DU-04: a transfer that times out, read through a restart and re-run."""
    print("\n== du04: a timed-out refund", flush=True)
    payer = new_payer()
    task = f"drill-du04-{secrets.token_hex(4)}"
    job = seed_settlement(task, payer.public_key)
    api = Backend("du04-open", backend_env(durable=True))
    _, opened = open_dispute(payer, job, 1)
    api.kill()
    dispute_id = opened["id"]
    calls = LOGS / f"du04-transfers-{dispute_id}.txt"
    tx = secrets.token_hex(32)
    env = uphold_env()

    code, out = run_uphold(dispute_id, env, calls, tx, "du04-run1")
    check("run 1 exits 10, the timeout code", code == 10, str(code))
    check("run 1 signed exactly one transfer", transfers_signed(calls) == 1)
    check("run 1 says the transfer timed out and may still land", "THE TRANSFER TIMED OUT — IT MAY STILL LAND." in out)
    check("run 1 says DO NOT RE-RUN THIS SCRIPT FOR THIS DISPUTE", "DO NOT RE-RUN THIS SCRIPT FOR THIS DISPUTE." in out)
    check("run 1 prints the in-flight hash", tx in out)
    check("run 1 never calls it a refusal", "REFUSED" not in out and "nothing was signed" not in out)
    check("the claim is in the reconciliation queue", dispute_id in reconciliation_queue())

    api = Backend("du04-after-restart", backend_env(durable=True))
    _, one = http("GET", f"/api/disputes/{dispute_id}")
    _, listing = http("GET", f"/api/tasks/{task}/disputes")
    api.kill()
    check("after a restart the dispute is still crediting", one.get("status") == "crediting", str(one.get("status")))
    check("the in-flight hash is on the record", one.get("refund_tx") == tx)
    check("no credited amount is reported", one.get("credited_usdc") is None, repr(one.get("credited_usdc")))
    check("no rating is reported", one.get("rating_tx") is None and one.get("rating_confirmed") is None)
    check("the task listing agrees", [d["status"] for d in listing["disputes"]] == ["crediting"])
    check("the claim is still queued after the restart", dispute_id in reconciliation_queue())


SCENARIOS: dict[str, Callable[[], None]] = {
    "du01": du01,
    "du01-control": du01_control,
    "du02": du02,
    "token-gap": token_gap,
    "du04": du04,
}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(SCENARIOS):
        SCENARIOS[name]()
    failed = [r for r in results if r[1] in {"FAIL", "XPASS"}]
    expected = [r for r in results if r[1] == "XFAIL"]
    print(f"\n{len(results) - len(failed) - len(expected)} passed, {len(expected)} expected failures, {len(failed)} failed")
    sys.exit(1 if failed else 0)
