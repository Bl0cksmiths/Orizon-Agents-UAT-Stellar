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
