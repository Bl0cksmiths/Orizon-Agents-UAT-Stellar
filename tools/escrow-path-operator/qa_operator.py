"""Story 6.07: the QA agents UAT owns for the escrow v2 payment path (EP-02, EP-03).

    python qa_operator.py fund                a NEW operator key in $OPERATOR_STATE, funded by friendbot
    python qa_operator.py register ID NAME SKILLS PRICE
                                              register ID on the AgentRegistry, owned by the operator;
                                              SKILLS is comma-separated, PRICE is per step in XLM

The operator's secret lives only in $OPERATOR_STATE/operator.json, which must be
outside the repository. Everything else this tool writes holds public keys, ids,
hashes and observed answers, never a secret.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from stellar_sdk import Keypair, TransactionEnvelope

REPO = Path(__file__).resolve().parents[2]
FRIENDBOT = "https://friendbot.stellar.org"
DEFAULT_API = "https://orizon-agents-be-stellar.onrender.com"
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


# name -> (command, how many positional arguments it takes)
COMMANDS: dict[str, tuple[Callable[..., int], int]] = {"fund": (fund, 0), "register": (register, 4)}


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
