"""The checks each artifact must pass, as pure functions of what the ledger returned.

Nothing here does I/O: every function takes a `HorizonCall` (and, for the
settle, its decoded events) and the facts the run recorded, and answers with
`Check`s. A check never trusts the API's word for an outcome; the API's word
is what is being checked.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from chain import HorizonCall


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str


def passed(checks: list[Check]) -> bool:
    return all(c.ok for c in checks)


def _call(name: str, call: HorizonCall, contract: str, function: str) -> list[Check]:
    return [
        Check(f"{name}_successful", call.successful, f"ledger {call.ledger}, closed {call.created_at}"),
        Check(f"{name}_contract", call.contract == contract, f"called {call.contract}"),
        Check(f"{name}_function", call.function == function, f"function {call.function!r}"),
    ]


def check_authorize(call: HorizonCall, escrow: str, payer: str, plan_id: str, max_stroops: int) -> list[Check]:
    """PaymentEscrow.authorize(payer, plan_id, max, expiry), signed by the payer,
    moving exactly `max` from the payer into the escrow's custody."""
    args = call.args
    custody = [t for t in call.transfers if t.source == payer and t.to == escrow]
    return [
        *_call("authorize", call, escrow, "authorize"),
        Check("authorize_source_is_payer", call.source_account == payer, f"source {call.source_account}"),
        Check("authorize_payer_arg", args[:1] == [payer], f"payer argument {args[:1]}"),
        Check("authorize_label_is_plan", args[1:2] == [plan_id], f"label {args[1:2]}"),
        Check("authorize_max", args[2:3] == [max_stroops], f"max {args[2:3]} stroops, plan {max_stroops}"),
        Check(
            "authorize_custody_transfer",
            [t.stroops for t in custody] == [max_stroops] and len(call.transfers) == 1,
            f"transfers {call.transfers}",
        ),
    ]


def check_settle(
    call: HorizonCall,
    events: list[dict[str, Any]],
    escrow: str,
    settler: str,
    auth_id: str,
    job_id: str,
    owners: dict[str, str],
    payer: str,
    max_stroops: int,
) -> tuple[list[Check], Counter[str]]:
    """PaymentEscrow.settle(settler, auth_id, job_id, payouts): each payout lands
    with its agent's on-chain owner as a `charged` event and a transfer, and the
    rest of the custody goes back to the payer. Returns (checks, paid per agent)."""
    args = call.args
    payouts = args[3] if len(args) > 3 and isinstance(args[3], list) else []
    paid: Counter[str] = Counter()
    for p in payouts:
        paid[str(p.get("agent_id"))] += int(p.get("amount") or 0)
    spent = sum(paid.values())
    expected_to_owner: Counter[str] = Counter()
    for agent, amount in paid.items():
        expected_to_owner[owners.get(agent, f"<no owner for {agent}>")] += amount
    to_owner: Counter[str] = Counter()
    returned = 0
    for t in call.transfers:
        if t.source != escrow:
            continue
        if t.to == payer:
            returned += t.stroops
        else:
            to_owner[t.to] += t.stroops
    charged = [e for e in events if e["topics"][:1] == ["charged"]]
    charged_paid: Counter[str] = Counter()
    for e in charged:
        value = e["value"] if isinstance(e["value"], list) else []
        charged_paid[str(e["topics"][1]) if len(e["topics"]) > 1 else ""] += int(value[2]) if len(value) > 2 else 0
    settled = [e for e in events if e["topics"][:1] == ["settled"]]
    settled_value = settled[0]["value"] if len(settled) == 1 and isinstance(settled[0]["value"], list) else []
    checks = [
        *_call("settle", call, escrow, "settle"),
        Check(
            "settle_signed_by_settler",
            call.source_account == settler == (args[:1] or [""])[0],
            f"source {call.source_account}",
        ),
        Check("settle_auth_id", args[1:2] == [auth_id], f"auth id {args[1:2]}, authorized {auth_id}"),
        Check("settle_job_id", args[2:3] == [job_id], f"job id {args[2:3]}, settlement {job_id}"),
        Check("settle_pays_someone", spent > 0, f"payouts {payouts}"),
        Check("settle_payouts_have_owners", all(a in owners for a in paid), f"owners {owners}"),
        Check("settle_transfers_to_owners", to_owner == expected_to_owner, f"to owners {dict(to_owner)}"),
        Check("settle_charged_events", charged_paid == paid, f"charged {dict(charged_paid)}, payouts {dict(paid)}"),
        Check(
            "settle_returned_remainder",
            returned == max_stroops - spent,
            f"returned {returned} to the payer; max {max_stroops} - spent {spent} = {max_stroops - spent}",
        ),
        Check(
            "settle_settled_event",
            settled_value[2:4] == [spent, max_stroops - spent],
            f"settled event {settled_value}",
        ),
    ]
    return checks, paid
