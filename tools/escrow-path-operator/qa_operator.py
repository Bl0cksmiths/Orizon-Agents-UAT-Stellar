"""Story 6.07: the QA agents UAT owns for the escrow v2 payment path (EP-02, EP-03).

    python qa_operator.py fund                a NEW operator key in $OPERATOR_STATE, funded by friendbot
    python qa_operator.py register ID NAME SKILLS PRICE
                                              register ID on the AgentRegistry, owned by the operator;
                                              SKILLS is comma-separated, PRICE is per step in XLM
    python qa_operator.py bind ID URL         bind ID to the HTTPS endpoint URL, signed by the owner (SEP-53)
    python qa_operator.py check ID URL        owner_of(ID) on-chain is the operator, the binding is URL's host,
                                              and the backend's readiness probe found the endpoint reachable
    python qa_operator.py plan KIND INTENT    decompose INTENT (no wallet, nothing authorized) and keep the plan
                                              as KIND if it fits: "single" routes only to $OPERATOR_OK_ID,
                                              "pair" is two steps, one on $OPERATOR_OK_ID, one on $OPERATOR_HANG_ID

The operator's secret lives only in $OPERATOR_STATE/operator.json, which must be
outside the repository. Everything else this tool writes holds public keys, ids,
hashes and observed answers, never a secret.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from stellar_sdk import Account, Keypair, TransactionBuilder, TransactionEnvelope, scval, xdr

REPO = Path(__file__).resolve().parents[2]
FRIENDBOT = "https://friendbot.stellar.org"
DEFAULT_API = "https://orizon-agents-be-stellar.onrender.com"
RPC = "https://soroban-testnet.stellar.org"
# The AgentRegistry the deployment reads (common.md); owner_of is asked of it directly.
AGENT_REGISTRY = "CAPHXWU53UZUZJGV7IAE57NNMH3YYB5MTWO6YA53KKMXSFVLOITBJ3GQ"
TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"
# A Soroban Symbol, as the backend's AGENT_ID_PATTERN; "-" is not in it.
SYMBOL = re.compile(r"^[A-Za-z0-9_]{1,32}$")
# QA agents are paid real testnet XLM per step; anything dearer is a typo.
MAX_STEP_PRICE_XLM = 0.05


class Refused(Exception):
    """The command stopped before or instead of a step; the message says why."""


def state_dir() -> Path:
    """$OPERATOR_STATE, refused when it is inside the repository: it holds a secret."""
    raw = os.environ.get("OPERATOR_STATE")
    if not raw:
        raise Refused("set OPERATOR_STATE to a directory outside the repository")
    path = Path(raw).resolve()
    if path == REPO or REPO in path.parents:
        raise Refused(f"OPERATOR_STATE {path} is inside the repository; it holds the operator's secret")
    path.mkdir(parents=True, exist_ok=True)
    return path


def http() -> httpx.Client:
    """One client for every call; it honours SSL_CERT_FILE for an intercepting proxy."""
    return httpx.Client(headers={"User-Agent": "orizon-uat-escrow-path-operator"}, follow_redirects=True)


def fund() -> int:
    """A fresh operator key, written to $OPERATOR_STATE/operator.json and funded by friendbot."""
    target = state_dir() / "operator.json"
    if target.exists():
        raise Refused(f"{target} exists; move it away to make a new operator")
    kp = Keypair.random()
    target.write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}), encoding="utf-8")
    response = http().get(FRIENDBOT, params={"addr": kp.public_key}, timeout=60.0)
    if not response.is_success:
        raise Refused(f"friendbot answered {response.status_code} for {kp.public_key}: {response.text[:300]}")
    print(f"operator {kp.public_key} funded by friendbot in {response.json()['hash']}")
    return 0


def load_operator() -> Keypair:
    source = state_dir() / "operator.json"
    if not source.exists():
        raise Refused(f"no operator in {source}; run `qa_operator.py fund` first")
    return Keypair.from_secret(json.loads(source.read_text(encoding="utf-8"))["secret"])


class Api:
    """The deployed API, called the way the dApp's operator console calls it."""

    def __init__(self, client: httpx.Client, base: str) -> None:
        self.client = client
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, *, body: Any = None, params: dict[str, str] | None = None) -> Any:
        """The JSON answer; any non-2xx is a refusal that quotes the API's own error code."""
        response = self.client.request(method, f"{self.base}{path}", json=body, params=params, timeout=105.0)
        if not response.is_success:
            raise Refused(f"{method} {path} answered {response.status_code}: {response.text[:300]}")
        return response.json()


def api() -> Api:
    return Api(http(), os.environ.get("OPERATOR_API", DEFAULT_API))


def symbol(value: str, what: str) -> str:
    if not SYMBOL.fullmatch(value):
        raise Refused(f"{what} {value!r} is not a Soroban Symbol: use 1-32 of [A-Za-z0-9_]")
    return value


def load_run() -> dict[str, Any]:
    """$OPERATOR_STATE/operator-run.json: every public fact this tool has observed."""
    source = state_dir() / "operator-run.json"
    if not source.exists():
        return {"agents": {}, "intents": {}}
    loaded: dict[str, Any] = json.loads(source.read_text(encoding="utf-8"))
    return loaded


def record_agent(agent_id: str, **facts: Any) -> None:
    run = load_run()
    run["agents"].setdefault(agent_id, {}).update(facts)
    (state_dir() / "operator-run.json").write_text(json.dumps(run, indent=2), encoding="utf-8")


def register(agent_id: str, name: str, skills: str, price: str) -> int:
    """Build the registration with the backend, sign it as the operator, submit it, record the hash."""
    symbol(agent_id, "agent id")
    if agent_id.startswith("agt_"):
        raise Refused(f"agent id {agent_id!r} is in the seeded agt_ namespace, which the backend reserves")
    skill_list = [symbol(skill, "skill") for skill in skills.split(",")]
    try:
        price_xlm = float(price)
    except ValueError:
        raise Refused(f"price {price!r} is not a number") from None
    if not 0 < price_xlm <= MAX_STEP_PRICE_XLM:
        raise Refused(f"price {price_xlm} XLM is outside (0, {MAX_STEP_PRICE_XLM}] for a QA agent")
    owner = load_operator()
    client = api()
    built = client.call(
        "POST",
        "/api/stellar/build/register-agent",
        body={
            "owner": owner.public_key,
            "agent_id": agent_id,
            "name": name,
            "skills": skill_list,
            "price_usdc": price_xlm,
        },
    )
    envelope = TransactionEnvelope.from_xdr(built["xdr"], TESTNET_PASSPHRASE)
    envelope.sign(owner)
    result = client.call("POST", "/api/stellar/submit", body={"signed_xdr": envelope.to_xdr()})
    if result.get("status") != "SUCCESS":
        raise Refused(f"registration {result.get('hash')} ended {result.get('status')}: {result.get('diagnostic')}")
    record_agent(
        agent_id,
        name=name,
        skills=skill_list,
        price_xlm=price_xlm,
        register_tx=result["hash"],
        register_ledger=result.get("ledger"),
    )
    print(f"registered {agent_id} owned by {owner.public_key} in {result['hash']}")
    return 0


def bind(agent_id: str, url: str) -> int:
    """Preflight the URL, take a challenge, sign it as the owner, bind, and check what the API stored."""
    symbol(agent_id, "agent id")
    if not url.startswith("https://"):
        raise Refused(f"endpoint {url!r} is not an https URL")
    owner = load_operator()
    client = api()
    preflight = client.call("GET", "/api/agents/bind/endpoint-check", params={"url": url})
    if not preflight.get("allowed"):
        raise Refused(f"the backend refuses {url} (rule {preflight.get('rule')}): {preflight.get('message')}")
    challenge = client.call("POST", f"/api/agents/{agent_id}/bind/challenge", body={"endpoint_url": url})
    signature = base64.b64encode(owner.sign_message(challenge["message"])).decode("ascii")
    bound = client.call("POST", f"/api/agents/{agent_id}/bind", body={"endpoint_url": url, "signature": signature})
    if bound.get("endpoint_url") != url or bound.get("owner") != owner.public_key:
        raise Refused(f"the bind answered {bound}, not {url} owned by {owner.public_key}")
    record_agent(
        agent_id,
        endpoint=url,
        bind={
            "endpoint_check": preflight,
            "challenge_expires_at": challenge["expires_at"],
            "bound_at": bound["bound_at"],
            "replaced": bound["replaced"],
            "owner": bound["owner"],
        },
    )
    print(f"bound {agent_id} to {url} at {bound['bound_at']} (replaced: {bound['replaced']})")
    return 0


def owner_of(client: httpx.Client, agent_id: str, source: str) -> str | None:
    """AgentRegistry.owner_of(agent_id), run in simulation; None when the registry has no such id."""
    tx = (
        TransactionBuilder(Account(source, 0), network_passphrase=TESTNET_PASSPHRASE, base_fee=100)
        .append_invoke_contract_function_op(AGENT_REGISTRY, "owner_of", [scval.to_symbol(agent_id)])
        .set_timeout(30)
        .build()
    )
    payload = {"jsonrpc": "2.0", "id": 1, "method": "simulateTransaction", "params": {"transaction": tx.to_xdr()}}
    response = client.post(RPC, json=payload, timeout=30.0)
    response.raise_for_status()
    result = response.json().get("result") or {}
    if result.get("error") or not result.get("results"):
        return None
    return str(scval.from_address(xdr.SCVal.from_xdr(result["results"][0]["xdr"])).address)


def check(agent_id: str, url: str) -> int:
    """The three preconditions EP-02 and EP-03 rest on, each read from its own source."""
    symbol(agent_id, "agent id")
    owner = load_operator().public_key
    client = api()
    on_chain = owner_of(client.client, agent_id, owner)
    if on_chain != owner:
        raise Refused(f"owner_of({agent_id}) on the registry is {on_chain}, not the operator {owner}")
    binding = client.call("GET", f"/api/agents/{agent_id}/binding")
    host = f"https://{urlsplit(url).hostname}"
    if binding.get("endpoint_url") != host or binding.get("owner") != owner:
        raise Refused(f"the binding reads {binding}, not {host} owned by {owner}")
    readiness = client.call("GET", f"/api/agents/{agent_id}/readiness")
    steps = {step["key"]: step for step in readiness["steps"]}
    reachable = steps["reachable"]
    record_agent(agent_id, check={"owner_of": on_chain, "binding": binding, "readiness": readiness})
    if reachable["status"] != "done":
        raise Refused(f"readiness says {agent_id} is not reachable: {reachable['detail']}")
    print(f"{agent_id}: owner_of={on_chain}, bound to {host}, reachable, ready={readiness['ready']}")
    for key, step in steps.items():
        print(f"  {key}: {step['status']} - {step['detail']}")
    return 0


def plan_fits(kind: str, agent_ids: list[str]) -> bool:
    """Whether a plan's step agents are what KIND needs."""
    ok = os.environ.get("OPERATOR_OK_ID", "qa607_ok")
    hang = os.environ.get("OPERATOR_HANG_ID", "qa607_hang")
    if kind == "single":
        return bool(agent_ids) and set(agent_ids) == {ok}
    return sorted(agent_ids) == sorted([ok, hang])


def plan(kind: str, intent: str) -> int:
    """One decompose, recorded whether or not it fits; kept as the KIND intent only when it does."""
    if kind not in ("single", "pair"):
        raise Refused(f"plan kind {kind!r} is neither single nor pair")
    answer = api().call("POST", "/api/orchestrator/decompose", body={"intent": intent})
    observed = {
        "intent": intent,
        "plan_id": answer["plan_id"],
        "steps": [
            {key: step.get(key) for key in ("agent_id", "agent_name", "est_price_usdc", "rep_bps", "degraded")}
            for step in answer["steps"]
        ],
        "total_xlm": answer["total_usdc"],
        "notices": answer.get("notices") or [],
        "observed_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    agent_ids = [step["agent_id"] for step in answer["steps"]]
    fits = plan_fits(kind, agent_ids)
    run = load_run()
    run.setdefault("attempts", []).append({"kind": kind, "fits": fits, **observed})
    if fits:
        run["intents"][kind] = observed
    (state_dir() / "operator-run.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
    for step in observed["steps"]:
        print(f"  {step['agent_id']} ({step['agent_name']}) {step['est_price_usdc']} XLM")
    print(f"  total {observed['total_xlm']} XLM, plan {observed['plan_id']}")
    if not fits:
        raise Refused(f"the plan routes to {agent_ids}, which is not a {kind} plan")
    print(f"kept as the {kind} intent")
    return 0


# name -> (command, how many positional arguments it takes)
COMMANDS: dict[str, tuple[Callable[..., int], int]] = {
    "fund": (fund, 0),
    "register": (register, 4),
    "bind": (bind, 2),
    "check": (check, 2),
    "plan": (plan, 2),
}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in COMMANDS or len(argv) - 1 != COMMANDS[argv[0]][1]:
        print(__doc__, file=sys.stderr)
        return 2
    command, _ = COMMANDS[argv[0]]
    try:
        return command(*argv[1:])
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
