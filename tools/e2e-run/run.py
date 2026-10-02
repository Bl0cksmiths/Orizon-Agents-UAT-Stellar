"""OV-08 (story 6.04): one complete validation workflow on the deployed dApp, on testnet.

    python run.py fund            a fresh buyer keypair in $E2E_STATE, funded by friendbot

The buyer's secret lives only in $E2E_STATE, which must be outside the
repository.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from chain import TESTNET_PASSPHRASE, Chain, ChainError
from stellar_sdk import Address, Keypair, TransactionEnvelope, scval
from stellar_sdk.operation import InvokeHostFunction

REPO = Path(__file__).resolve().parents[2]
TASK_TOKEN_HEADER = "X-Task-Token"
EXPLORER = "https://stellar.expert/explorer/testnet/tx/"
AUTHORIZE_TTL_SECONDS = 1800
TERMINAL = ("complete", "failed")


class Refused(Exception):
    """The run stopped before or instead of a step; the message says why."""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def to_stroops(amount: float) -> int:
    """The backend's `usdc_to_i128`: `round(amount * 10_000_000)`."""
    return round(amount * 10_000_000)


def owner_of(chain: Chain, registry: str, agent_id: str, source: str) -> str | None:
    """The agent's owner on the AgentRegistry itself, not the API's word for it."""
    try:
        return str(chain.view(registry, "owner_of", [scval.to_symbol(agent_id)], source))
    except ChainError:
        return None


def state_dir() -> Path:
    """$E2E_STATE, refused when it is inside the repository: it holds a secret."""
    raw = os.environ.get("E2E_STATE")
    if not raw:
        raise Refused("set E2E_STATE to a directory outside the repository")
    path = Path(raw).resolve()
    if path == REPO or REPO in path.parents:
        raise Refused(f"E2E_STATE {path} is inside the repository; it holds the buyer's secret")
    path.mkdir(parents=True, exist_ok=True)
    return path


def http() -> httpx.Client:
    """One client for every call; it honours SSL_CERT_FILE for an intercepting proxy."""
    return httpx.Client(headers={"User-Agent": "orizon-uat-e2e-run"}, follow_redirects=True)


def fund() -> int:
    """A fresh throwaway buyer, written to $E2E_STATE/buyer.json and funded by friendbot."""
    target = state_dir() / "buyer.json"
    if target.exists():
        raise Refused(f"{target} exists; move it away to make a new buyer")
    kp = Keypair.random()
    target.write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}), encoding="utf-8")
    funding = Chain(http()).fund(kp.public_key)
    print(f"buyer {kp.public_key} funded by friendbot in {funding}")
    return 0


def load_buyer() -> Keypair:
    source = state_dir() / "buyer.json"
    if not source.exists():
        raise Refused(f"no buyer in {source}; run `run.py fund` first")
    return Keypair.from_secret(json.loads(source.read_text(encoding="utf-8"))["secret"])


class Api:
    """The deployed API, called the way the dApp calls it."""

    def __init__(self, client: httpx.Client, base: str) -> None:
        self.client = client
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, *, body: Any = None, token: str | None = None) -> Any:
        headers = {TASK_TOKEN_HEADER: token} if token else None
        response = self.client.request(method, f"{self.base}{path}", json=body, headers=headers, timeout=105.0)
        if not response.is_success:
            raise Refused(f"{method} {path} answered {response.status_code}: {response.text[:300]}")
        return response.json()

    def wake(self) -> None:
        """Render's free tier sleeps; /api/health answers once it is up."""
        deadline = time.monotonic() + 180
        while True:
            try:
                self.call("GET", "/api/health")
                return
            except (httpx.TransportError, Refused):
                if time.monotonic() > deadline:
                    raise
                time.sleep(5)


def inspect_authorize(xdr: str, payer: str, escrow: str, plan_id: str, max_stroops: int) -> TransactionEnvelope:
    """The prepared envelope, refused unless it is exactly the authorize that was asked for."""
    env = TransactionEnvelope.from_xdr(xdr, TESTNET_PASSPHRASE)
    ops = env.transaction.operations
    if len(ops) != 1 or not isinstance(ops[0], InvokeHostFunction) or ops[0].host_function.invoke_contract is None:
        raise Refused("the authorize envelope is not a single contract call")
    invoke = ops[0].host_function.invoke_contract
    args = [scval.to_native(a) for a in invoke.args]
    seen = {
        "source": env.transaction.source.account_id,
        "contract": Address.from_xdr_sc_address(invoke.contract_address).address,
        "function": invoke.function_name.sc_symbol.decode(),
        "args": [a.address if isinstance(a, Address) else a for a in args[:3]],
    }
    wanted = {"source": payer, "contract": escrow, "function": "authorize", "args": [payer, plan_id, max_stroops]}
    if seen != wanted:
        raise Refused(f"refusing to sign: envelope {seen} is not {wanted}")
    return env


def auth_id_from(value: Any) -> str:
    """The 16-byte auth id a submit returns, as hex, from hex, base64 or a byte list."""
    if isinstance(value, str) and len(value) == 32:
        return value.lower()
    if isinstance(value, str):
        raw = base64.b64decode(value)
        if len(raw) == 16:
            return raw.hex()
    if isinstance(value, list) and len(value) == 16:
        return bytes(value).hex()
    raise Refused(f"cannot read an auth id from the submit's return value {value!r}")


class Run:
    """One run, its record written to disk after every artifact."""

    def __init__(self, api: Api, chain: Chain, buyer: Keypair, intent: str, out: Path) -> None:
        self.api, self.chain, self.buyer = api, chain, buyer
        self.out = out
        self.token: str | None = None
        self.record: dict[str, Any] = {
            "story": "6.04",
            "criterion": "OV-08",
            "run_id": datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ"),
            "api": api.base,
            "buyer": buyer.public_key,
            "intent": intent,
            "artifacts": [],
        }

    def save(self) -> None:
        self.out.write_text(json.dumps(self.record, indent=2) + "\n", encoding="utf-8")

    def capture(self, kind: str, **fields: Any) -> dict[str, Any]:
        """An artifact, written down the moment it is seen."""
        item = {"kind": kind, "captured_at": now(), **fields}
        if fields.get("tx_hash"):
            item["explorer"] = EXPLORER + str(fields["tx_hash"])
        self.record["artifacts"].append(item)
        self.save()
        print(f"[{item['captured_at']}] {kind}: {fields.get('tx_hash') or fields}")
        return item

    def artifact(self, kind: str) -> dict[str, Any]:
        return next(a for a in self.record["artifacts"] if a["kind"] == kind)

    def preflight(self) -> None:
        """Testnet, escrow v2 by its own `version()` view, and the settler it trusts."""
        self.api.wake()
        network = self.api.call("GET", "/api/stellar/network")
        if network.get("network_passphrase") != TESTNET_PASSPHRASE:
            raise Refused(f"the API is on {network.get('network')}, not testnet")
        contracts = network["contracts"]
        source = self.buyer.public_key
        version = self.chain.view(contracts["payment_escrow"], "version", [], source)
        if version != 2:
            raise Refused(f"escrow {contracts['payment_escrow']} answers version {version}, not 2")
        self.record.update(
            network="testnet",
            asset=network.get("asset"),
            contracts=contracts,
            escrow_version=version,
            settler=self.chain.view(contracts["payment_escrow"], "settler", [], source),
        )
        self.save()

    def decompose(self) -> None:
        """The plan, refused before anything is signed unless every step's agent has
        an on-chain owner, the total is the sum of the steps, and it is under the cap."""
        plan = self.api.call("POST", "/api/orchestrator/decompose", body={"intent": self.record["intent"]})
        steps = [{"agent_id": s["agent_id"], "est_price_usdc": s["est_price_usdc"]} for s in plan["steps"]]
        registry = self.record["contracts"]["agent_registry"]
        owners = {s["agent_id"]: owner_of(self.chain, registry, s["agent_id"], self.buyer.public_key) for s in steps}
        cap = float(os.environ.get("E2E_MAX_TOTAL_XLM", "0.05"))
        reachable = {a: self.reachability(a) for a in owners}
        self.capture(
            "plan",
            plan_id=plan["plan_id"],
            total_usdc=plan["total_usdc"],
            steps=steps,
            owners=owners,
            reachable=reachable,
        )
        if not steps or any(o is None for o in owners.values()):
            raise Refused(f"the plan routes to an agent with no on-chain owner {owners}; nothing was signed")
        dead = {a: r for a, r in reachable.items() if r["status"] == "failed"}
        if dead and os.environ.get("E2E_ALLOW_UNREACHABLE") != "1":
            raise Refused(
                f"the plan routes to an agent whose endpoint fails the backend's own probe {dead}; "
                "nothing was signed (E2E_ALLOW_UNREACHABLE=1 runs it anyway, to watch the failure path)"
            )
        if to_stroops(plan["total_usdc"]) != sum(to_stroops(s["est_price_usdc"]) for s in steps):
            raise Refused("the plan's total is not the sum of its steps; nothing was signed")
        if plan["total_usdc"] > cap:
            raise Refused(f"the plan costs {plan['total_usdc']} XLM, over E2E_MAX_TOTAL_XLM={cap}; nothing was signed")
        self.record["plan"] = {"plan_id": plan["plan_id"], "total_usdc": plan["total_usdc"], "steps": steps}
        self.record["owners"] = owners

    def authorize(self) -> None:
        """The API builds the authorize; the buyer signs it only after reading it back."""
        plan = self.record["plan"]
        max_stroops = to_stroops(plan["total_usdc"])
        built = self.api.call(
            "POST",
            "/api/stellar/build/authorize",
            body={
                "payer": self.buyer.public_key,
                "agent_id": plan["plan_id"],
                "max_amount_usdc": plan["total_usdc"],
                "ttl_seconds": AUTHORIZE_TTL_SECONDS,
            },
        )
        escrow = self.record["contracts"]["payment_escrow"]
        env = inspect_authorize(built["xdr"], self.buyer.public_key, escrow, plan["plan_id"], max_stroops)
        env.sign(self.buyer)
        result = self.api.call("POST", "/api/stellar/submit", body={"signed_xdr": env.to_xdr()})
        self.capture(
            "authorize",
            tx_hash=result["hash"],
            api_status=result.get("status"),
            auth_id_hex=auth_id_from(result.get("return_value")),
            max_stroops=max_stroops,
            expires_at=built.get("expires_at"),
        )
        if result.get("status") != "SUCCESS":
            raise Refused(f"the authorize submit answered {result.get('status')}")

    def execute(self) -> None:
        """The stored plan, run against the authorization; the task's read token is
        kept in memory for the polls and never written to the record."""
        started = self.api.call(
            "POST",
            "/api/orchestrator/execute",
            body={
                "plan_id": self.record["plan"]["plan_id"],
                "auth_id_hex": self.artifact("authorize")["auth_id_hex"],
                "payer": self.buyer.public_key,
            },
        )
        self.token = started.get("read_token")
        self.capture("task", task_id=started["task_id"])

    def poll(self) -> None:
        """Polls the task until it is terminal and both its transactions are out,
        capturing each transaction hash the moment the task first shows it. A
        terminal task gets a minute's grace for a transaction still on its way."""
        task_id = self.artifact("task")["task_id"]
        deadline = time.monotonic() + float(os.environ.get("E2E_TASK_BUDGET_S", "600"))
        seen: set[str] = set()
        grace: float | None = None
        while True:
            task = self.api.call("GET", f"/api/tasks/{task_id}", token=self.token)
            for field, kind in (("charge_tx", "settle"), ("proof_tx", "seal")):
                if task.get(field) and kind not in seen:
                    seen.add(kind)
                    self.capture(kind, tx_hash=task[field], task_status=task.get("status"))
            if task.get("status") in TERMINAL:
                grace = grace or time.monotonic() + 60
                if len(seen) == 2 or time.monotonic() > grace:
                    break
            if time.monotonic() > deadline:
                raise Refused(f"task {task_id} is {task.get('status')} with {sorted(seen)} after the budget")
            time.sleep(1.5)
        self.capture(
            "task_terminal",
            task_id=task_id,
            status=task["status"],
            spent=task.get("spent"),
            settlement_state=task.get("settlement"),
            trace=[
                f"{line['t']} {line['level']} {line['msg']}"
                for line in self.api.call("GET", f"/api/trace/{task_id}", token=self.token)
            ],
        )
        if (task["status"], task.get("settlement"), len(seen)) != ("complete", "settled", 2):
            raise Refused(f"task {task_id} ended {task['status']}, settlement {task.get('settlement')}, not settled")

    def settlement(self) -> None:
        """The settlement record the dispute routes start from, and its window."""
        task_id = self.artifact("task")["task_id"]
        listing = self.api.call("GET", f"/api/tasks/{task_id}/disputes", token=self.token)
        s = listing.get("settlement")
        if not s:
            raise Refused(f"task {task_id} has no settlement record")
        fields = ("step_index", "agent_id", "price_usdc", "delivered", "paid_usdc", "receipt_id_hex", "unpaid_reason")
        self.capture(
            "settlement",
            job_id_hex=s["job_id_hex"],
            payer=s["payer"],
            settled_usdc=s["settled_usdc"],
            charge_tx=s["charge_tx"],
            proof_tx=s["proof_tx"],
            window_closes_at=listing.get("window_closes_at"),
            steps=[{k: step.get(k) for k in fields} for step in s["steps"]],
        )

    def reachability(self, agent_id: str) -> dict[str, Any]:
        """The backend's own readiness probe of the agent's bound endpoint: its
        `reachable` step, as `{status, detail}`."""
        readiness = self.api.call("GET", f"/api/agents/{agent_id}/readiness")
        step = next((s for s in readiness.get("steps") or [] if s.get("key") == "reachable"), None)
        if step is None:
            return {"status": "unknown", "detail": "the readiness answer has no `reachable` step"}
        return {"status": step.get("status"), "detail": step.get("detail")}


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "fund" and len(argv) == 2:
            return fund()
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(__doc__, file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))
