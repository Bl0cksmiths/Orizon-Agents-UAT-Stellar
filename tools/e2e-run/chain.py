"""Read-only testnet access for the e2e run: Horizon, Soroban RPC and friendbot.

Horizon is the witness every artifact is checked against: a transaction's
outcome, its one contract call with every argument, and the asset transfers it
made. Soroban RPC adds what Horizon does not serve: contract events (the
`charged` and `settled` events of a settle) and contract views, read by
simulation, which executes nothing on the ledger.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from stellar_sdk import Address, scval
from stellar_sdk import xdr as stellar_xdr

HORIZON = "https://horizon-testnet.stellar.org"
RPC = "https://soroban-testnet.stellar.org"
FRIENDBOT = "https://friendbot.stellar.org"
TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"
STROOPS_PER_UNIT = 10_000_000


def plain(value: Any) -> Any:
    """`scval.to_native` output made JSON-plain: addresses as strkeys, bytes as hex."""
    if isinstance(value, Address):
        return value.address
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    if isinstance(value, dict):
        return {str(plain(k)): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


def decode_scval(b64: str) -> Any:
    return plain(scval.to_native(stellar_xdr.SCVal.from_xdr(b64)))


def to_stroops(amount: str) -> int:
    """A Horizon decimal amount ("0.0100000") in stroops, without float rounding."""
    whole, _, frac = amount.partition(".")
    return int(whole) * STROOPS_PER_UNIT + int((frac + "0000000")[:7])


@dataclass(frozen=True)
class Transfer:
    source: str
    to: str
    stroops: int


@dataclass(frozen=True)
class HorizonCall:
    """One transaction as Horizon reports it, reduced to its single contract call."""

    tx_hash: str
    successful: bool
    ledger: int
    created_at: str
    source_account: str
    fee_charged: int
    contract: str
    function: str
    args: list[Any]
    transfers: list[Transfer]


class ChainError(Exception):
    """Horizon or the RPC gave no usable answer."""


@dataclass
class Chain:
    client: httpx.Client
    horizon: str = HORIZON
    rpc_url: str = RPC

    def horizon_json(self, path: str) -> dict[str, Any] | None:
        """A Horizon resource, or None on 404 (an answer, not an outage)."""
        response = self.client.get(f"{self.horizon}{path}", timeout=30.0)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def fund(self, public_key: str) -> str:
        """Friendbot funds a fresh testnet account; returns the funding tx hash."""
        response = self.client.get(FRIENDBOT, params={"addr": public_key}, timeout=60.0)
        response.raise_for_status()
        return str(response.json()["hash"])

    def horizon_call(self, tx_hash: str, wait: float = 60.0) -> HorizonCall:
        """`tx_hash` read from Horizon, waiting up to `wait` seconds for ingestion."""
        deadline = time.monotonic() + wait
        record = self.horizon_json(f"/transactions/{tx_hash}")
        while record is None and time.monotonic() < deadline:
            time.sleep(2.0)
            record = self.horizon_json(f"/transactions/{tx_hash}")
        if record is None:
            raise ChainError(f"Horizon has no transaction {tx_hash}")
        ops = (self.horizon_json(f"/transactions/{tx_hash}/operations") or {})["_embedded"]["records"]
        if len(ops) != 1 or ops[0].get("type") != "invoke_host_function":
            raise ChainError(f"{tx_hash} carries {len(ops)} operation(s), not one contract call")
        params = [decode_scval(p["value"]) for p in ops[0].get("parameters") or []]
        transfers = [
            Transfer(c["from"], c["to"], to_stroops(c["amount"]))
            for c in ops[0].get("asset_balance_changes") or []
            if c.get("type") == "transfer"
        ]
        return HorizonCall(
            tx_hash=tx_hash,
            successful=record.get("successful") is True,
            ledger=int(record["ledger"]),
            created_at=str(record["created_at"]),
            source_account=str(record["source_account"]),
            fee_charged=int(record["fee_charged"]),
            contract=str(params[0]) if params else "",
            function=str(params[1]) if len(params) > 1 else "",
            args=params[2:],
            transfers=transfers,
        )

    def rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
        if params is not None:
            payload["params"] = params
        response = self.client.post(self.rpc_url, json=payload, timeout=30.0)
        response.raise_for_status()
        body = response.json()
        if "error" in body:
            raise ChainError(f"{method}: {body['error']}")
        return body["result"]

    def events(self, contract_id: str, ledger: int, tx_hash: str) -> list[dict[str, Any]]:
        """`contract_id`'s events emitted by `tx_hash`, decoded: [{topics, value}]."""
        result = self.rpc(
            "getEvents",
            {
                "startLedger": ledger,
                "filters": [{"type": "contract", "contractIds": [contract_id]}],
                "pagination": {"limit": 200},
            },
        )
        return [
            {
                "topics": [decode_scval(t) for t in raw.get("topic") or []],
                "value": decode_scval(raw["value"]) if raw.get("value") else None,
            }
            for raw in result.get("events") or []
            if raw.get("txHash") == tx_hash
        ]
