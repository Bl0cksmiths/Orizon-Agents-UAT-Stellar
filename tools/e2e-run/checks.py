"""The checks each artifact must pass, as pure functions of what the ledger returned.

Nothing here does I/O: every function takes a `HorizonCall` (and, for the
settle, its decoded events) and the facts the run recorded, and answers with
`Check`s. A check never trusts the API's word for an outcome; the API's word
is what is being checked.
"""

from __future__ import annotations

from dataclasses import dataclass

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
