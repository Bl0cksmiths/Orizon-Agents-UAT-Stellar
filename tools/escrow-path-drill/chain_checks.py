"""The escrow path drill's chain checks (story 6.07): what the ledger says, never what the dApp says.

    python chain_checks.py COMMAND < facts.json > checks.json

Each command reads the facts the browser captured (hashes, ids, amounts) as
JSON on stdin and answers {"checks": [{name, ok, detail}], "facts": {...}}
read from Horizon and Soroban RPC. The pure checks are the e2e run's own
(tools/e2e-run/checks.py); this adds the ones story 6.07 asks for.

Runs on the backend's virtualenv, which has `httpx` and `stellar_sdk`.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
from stellar_sdk import scval

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "e2e-run"))

from chain import Chain, to_stroops  # noqa: E402
from checks import Check, check_authorize, check_settle  # noqa: E402

ESCROW = "CCNO5TENCK3EK532I3OZLZ63323FEEULPAKJ74CUP3JZK3XQINRQ5VC4"
REGISTRY = "CAPHXWU53UZUZJGV7IAE57NNMH3YYB5MTWO6YA53KKMXSFVLOITBJ3GQ"
# Settler, sealer and scorer: the backend's one server key.
SETTLER = "GDB4N25UYM3YNTTAWX7LSGI2P7OR62QZQXRNQWAGF5TFVENDKCTTCDHP"


def chain() -> Chain:
    """One client for every read; it honours SSL_CERT_FILE for an intercepting proxy."""
    return Chain(httpx.Client(headers={"User-Agent": "orizon-uat-escrow-path-drill"}, follow_redirects=True))


def authorization(c: Chain, auth_id: str, source: str) -> dict[str, Any]:
    """The escrow's own view of an authorization, read by simulation."""
    view: dict[str, Any] = c.view(ESCROW, "authorization", [scval.to_bytes(bytes.fromhex(auth_id))], source)
    return view


def authorize(facts: dict[str, Any]) -> dict[str, Any]:
    """EP-01: custody taken. The max left the buyer with the fee and nothing else, and reached the escrow."""
    c = chain()
    payer, max_stroops, auth_id = facts["payer"], int(facts["max_stroops"]), facts["auth_id"]
    call = c.horizon_call(facts["tx"])
    events = c.events(ESCROW, call.ledger, call.tx_hash)
    authd = [e for e in events if e["topics"][:1] == ["authd"]]
    value = authd[0]["value"] if len(authd) == 1 else []
    fell = int(facts["balance_before"]) - int(facts["balance_after"])
    view = authorization(c, auth_id, payer)
    checks = [
        *check_authorize(call, ESCROW, payer, facts["plan_id"], max_stroops),
        Check(
            "authd_event",
            len(authd) == 1 and authd[0]["topics"] == ["authd", facts["plan_id"]] and value == [auth_id, payer, max_stroops],
            f"authd events {authd}",
        ),
        Check("buyer_fell_by_max_plus_fee", fell == max_stroops + call.fee_charged, f"fell {fell}; max {max_stroops} + fee {call.fee_charged}"),
        Check("view_unsettled", view.get("settled") is False and int(view.get("spent", -1)) == 0, f"authorization {view}"),
        Check("view_max_and_payer", int(view.get("max_amount", -1)) == max_stroops and view.get("payer") == payer, f"authorization {view}"),
    ]
    return {"checks": [asdict(k) for k in checks], "facts": {"ledger": call.ledger, "fee_charged": call.fee_charged, "view": view}}


def balance(facts: dict[str, Any]) -> dict[str, Any]:
    """An account's native balance in stroops, and the ledger Horizon read it at."""
    c = chain()
    account = c.horizon_json(f"/accounts/{facts['account']}")
    if account is None:
        return {"checks": [asdict(Check("account_exists", False, f"Horizon has no account {facts['account']}"))], "facts": {}}
    native = next(b["balance"] for b in account["balances"] if b["asset_type"] == "native")
    return {"checks": [], "facts": {"stroops": to_stroops(native), "ledger": account.get("last_modified_ledger")}}


def settle(facts: dict[str, Any]) -> dict[str, Any]:
    """EP-02/03: the settle paid each delivered step its price, to its owner, and returned the rest."""
    c = chain()
    payer, max_stroops, auth_id = facts["payer"], int(facts["max_stroops"]), facts["auth_id"]
    prices: dict[str, int] = {a: int(p) for a, p in facts["prices"].items()}
    call = c.horizon_call(facts["tx"])
    events = c.events(ESCROW, call.ledger, call.tx_hash)
    job_id = str(call.args[2]) if len(call.args) > 2 else ""
    owners = {a: str(c.view(REGISTRY, "owner_of", [scval.to_symbol(a)], payer)) for a in prices}
    checks, paid = check_settle(call, events, ESCROW, SETTLER, auth_id, job_id, owners, payer, max_stroops)
    expected = {a: prices[a] for a in facts["delivered"]}
    charged = [e for e in events if e["topics"][:1] == ["charged"]]
    receipts = [str(e["value"][0]) for e in charged]
    spent = sum(paid.values())
    view = authorization(c, auth_id, payer)
    checks += [
        Check("paid_only_delivered_at_price", dict(paid) == expected, f"paid {dict(paid)}, delivered at price {expected}"),
        Check("charged_names_auth_and_job", all(e["value"][1:4:2] == [auth_id, job_id] for e in charged), f"charged {charged}"),
        Check("view_settled", view.get("settled") is True and int(view.get("spent", -1)) == spent, f"authorization {view}"),
    ]
    return {
        "checks": [asdict(k) for k in checks],
        "facts": {"ledger": call.ledger, "job_id": job_id, "owners": owners, "paid": dict(paid), "receipts": receipts, "returned": max_stroops - spent},
    }


def main(argv: list[str]) -> int:
    commands = {"authorize": authorize, "balance": balance, "settle": settle}
    if len(argv) != 1 or argv[0] not in commands:
        print(__doc__, file=sys.stderr)
        return 2
    print(json.dumps(commands[argv[0]](json.load(sys.stdin)), default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
