"""The escrow path drill's buyer key (story 6.07): a fresh testnet account, funded by friendbot.

    python buyer.py fund      a NEW buyer in $ESCROW_DRILL_STATE/buyer.json, its public key in buyer.pub

Runs on the backend's virtualenv, which has `httpx` and `stellar_sdk`. The
state directory holds a secret, so it must be outside the repository.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
from stellar_sdk import Keypair

REPO = Path(__file__).resolve().parents[2]
FRIENDBOT = "https://friendbot.stellar.org"


class Refused(Exception):
    """The tool stopped before doing anything; the message says why."""


def state_dir() -> Path:
    """$ESCROW_DRILL_STATE, refused when it is inside the repository: it holds the buyer's secret."""
    raw = os.environ.get("ESCROW_DRILL_STATE")
    if not raw:
        raise Refused("set ESCROW_DRILL_STATE to a directory outside the repository")
    path = Path(raw).resolve()
    if path == REPO or REPO in path.parents:
        raise Refused(f"ESCROW_DRILL_STATE {path} is inside the repository; it holds the buyer's secret")
    path.mkdir(parents=True, exist_ok=True)
    return path


def fund() -> int:
    """A new buyer, written before funding so a failed friendbot call never loses the key."""
    state = state_dir()
    target = state / "buyer.json"
    if (state / "buyer.pub").exists():
        raise Refused(f"{state / 'buyer.pub'} exists; move buyer.json and buyer.pub away to make a new buyer")
    if target.exists():
        # Written by a run whose friendbot call failed: fund that key rather than lose it.
        kp = Keypair.from_secret(json.loads(target.read_text(encoding="utf-8"))["secret"])
    else:
        kp = Keypair.random()
        target.write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}), encoding="utf-8")
    response = httpx.get(FRIENDBOT, params={"addr": kp.public_key}, timeout=60.0)
    response.raise_for_status()
    (state / "buyer.pub").write_text(kp.public_key + "\n", encoding="utf-8")
    print(f"buyer {kp.public_key} funded by friendbot in {response.json()['hash']}")
    return 0


def main(argv: list[str]) -> int:
    commands = {"fund": fund}
    if len(argv) != 1 or argv[0] not in commands:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        return commands[argv[0]]()
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
