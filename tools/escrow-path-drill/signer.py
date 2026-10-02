"""The escrow path drill's wallet signer (story 6.07): signs what the dApp asks Freighter to sign.

    python signer.py sign PASSPHRASE < envelope.xdr > signed.xdr
    python signer.py verify PASSPHRASE G... < signed.xdr       exactly one signature, G...'s, over the hash

The key is read from the file named by $ESCROW_DRILL_KEY (a buyer.json written
by buyer.py), never from an argument. Only one kind of envelope is signed: a
single InvokeHostFunction on the escrow ($ESCROW_DRILL_ESCROW, escrow v2 by
default) calling `authorize` or `reclaim` with the buyer as payer and as the
transaction's source. Anything else is refused, so a page cannot spend the key
on anything but the payment path under test.

Runs on the backend's virtualenv, which has `stellar_sdk`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from stellar_sdk import Address, Keypair, TransactionEnvelope, scval
from stellar_sdk.operation import InvokeHostFunction

ESCROW_V2 = "CCNO5TENCK3EK532I3OZLZ63323FEEULPAKJ74CUP3JZK3XQINRQ5VC4"
SIGNABLE = ("authorize", "reclaim")


class Refused(Exception):
    """Nothing was signed; the message says why."""


def load_key() -> Keypair:
    raw = os.environ.get("ESCROW_DRILL_KEY")
    if not raw:
        raise Refused("set ESCROW_DRILL_KEY to the buyer.json written by buyer.py")
    return Keypair.from_secret(json.loads(Path(raw).read_text(encoding="utf-8"))["secret"])


def inspect(env: TransactionEnvelope, payer: str, escrow: str) -> str:
    """The function the envelope calls, once it is shown to be one the drill may sign."""
    ops = env.transaction.operations
    if len(ops) != 1 or not isinstance(ops[0], InvokeHostFunction) or ops[0].host_function.invoke_contract is None:
        raise Refused("the envelope is not a single contract call")
    invoke = ops[0].host_function.invoke_contract
    contract = Address.from_xdr_sc_address(invoke.contract_address).address
    function = invoke.function_name.sc_symbol.decode()
    first = scval.to_native(invoke.args[0]) if invoke.args else None
    seen = {
        "source": env.transaction.source.account_id,
        "contract": contract,
        "payer": first.address if isinstance(first, Address) else first,
    }
    wanted = {"source": payer, "contract": escrow, "payer": payer}
    if seen != wanted or function not in SIGNABLE:
        raise Refused(f"refusing to sign {function!r} with {seen}; only {SIGNABLE} with {wanted}")
    return function


def sign(passphrase: str) -> int:
    key = load_key()
    escrow = os.environ.get("ESCROW_DRILL_ESCROW", ESCROW_V2)
    try:
        env = TransactionEnvelope.from_xdr(sys.stdin.read().strip(), passphrase)
    except (ValueError, EOFError) as e:
        raise Refused(f"the input is not a transaction envelope: {e!r}") from e
    inspect(env, key.public_key, escrow)
    env.sign(key)
    sys.stdout.write(env.to_xdr())
    return 0


def verify(passphrase: str, public_key: str) -> int:
    """A signed envelope on stdin carries exactly one signature, and it is `public_key`'s over its hash."""
    try:
        env = TransactionEnvelope.from_xdr(sys.stdin.read().strip(), passphrase)
    except (ValueError, EOFError) as e:
        raise Refused(f"the input is not a transaction envelope: {e!r}") from e
    if len(env.signatures) != 1:
        raise Refused(f"the envelope carries {len(env.signatures)} signatures, not one")
    try:
        Keypair.from_public_key(public_key).verify(env.hash(), env.signatures[0].signature)
    except Exception as e:
        raise Refused(f"the signature is not {public_key}'s over the envelope hash") from e
    print(f"signed by {public_key}: {env.hash_hex()}")
    return 0


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 2 and argv[0] == "sign":
            return sign(argv[1])
        if len(argv) == 3 and argv[0] == "verify":
            return verify(argv[1], argv[2])
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
