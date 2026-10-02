"""OV-08 (story 6.04): one complete validation workflow on the deployed dApp, on testnet.

    python run.py fund            a fresh buyer keypair in $E2E_STATE, funded by friendbot

The buyer's secret lives only in $E2E_STATE, which must be outside the
repository.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx
from chain import Chain
from stellar_sdk import Keypair

REPO = Path(__file__).resolve().parents[2]


class Refused(Exception):
    """The run stopped before or instead of a step; the message says why."""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def state_dir() -> Path:
    """$E2E_STATE, refused when it is inside the repository: it holds a secret."""
    raw = os.environ.get("E2E_STATE")
    if not raw:
        raise Refused("set E2E_STATE to a directory outside the repository")
    path = Path(raw).resolve()
    if path == REPO or REPO in path.parents:
        raise Refused(f"E2E_STATE {path} is inside the repository; it holds the buyer's secret")
    path.mkdir(parents=True, exist_ok=True)
    return path


def http() -> httpx.Client:
    """One client for every call; it honours SSL_CERT_FILE for an intercepting proxy."""
    return httpx.Client(headers={"User-Agent": "orizon-uat-e2e-run"}, follow_redirects=True)


def fund() -> int:
    """A fresh throwaway buyer, written to $E2E_STATE/buyer.json and funded by friendbot."""
    target = state_dir() / "buyer.json"
    if target.exists():
        raise Refused(f"{target} exists; move it away to make a new buyer")
    kp = Keypair.random()
    target.write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}), encoding="utf-8")
    funding = Chain(http()).fund(kp.public_key)
    print(f"buyer {kp.public_key} funded by friendbot in {funding}")
    return 0


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "fund" and len(argv) == 2:
            return fund()
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(__doc__, file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))
