"""Read-only testnet access for the e2e run: Horizon, Soroban RPC and friendbot.

Horizon is the witness every artifact is checked against: a transaction's
outcome, its one contract call with every argument, and the asset transfers it
made. Soroban RPC adds what Horizon does not serve: contract events (the
`charged` and `settled` events of a settle) and contract views, read by
simulation, which executes nothing on the ledger.
"""

from __future__ import annotations

from typing import Any

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
