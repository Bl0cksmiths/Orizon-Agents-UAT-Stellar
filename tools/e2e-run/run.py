"""OV-08 (story 6.04): one complete validation workflow on the deployed dApp, on testnet.

    python run.py fund            a fresh buyer keypair in $E2E_STATE, funded by friendbot

The buyer's secret lives only in $E2E_STATE, which must be outside the
repository.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from chain import Chain
from stellar_sdk import Keypair

REPO = Path(__file__).resolve().parents[2]
TASK_TOKEN_HEADER = "X-Task-Token"


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


def load_buyer() -> Keypair:
    source = state_dir() / "buyer.json"
    if not source.exists():
        raise Refused(f"no buyer in {source}; run `run.py fund` first")
    return Keypair.from_secret(json.loads(source.read_text(encoding="utf-8"))["secret"])


class Api:
    """The deployed API, called the way the dApp calls it."""

    def __init__(self, client: httpx.Client, base: str) -> None:
        self.client = client
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, *, body: Any = None, token: str | None = None) -> Any:
        headers = {TASK_TOKEN_HEADER: token} if token else None
        response = self.client.request(method, f"{self.base}{path}", json=body, headers=headers, timeout=105.0)
        if not response.is_success:
            raise Refused(f"{method} {path} answered {response.status_code}: {response.text[:300]}")
        return response.json()

    def wake(self) -> None:
        """Render's free tier sleeps; /api/health answers once it is up."""
        deadline = time.monotonic() + 180
        while True:
            try:
                self.call("GET", "/api/health")
                return
            except (httpx.TransportError, Refused):
                if time.monotonic() > deadline:
                    raise
                time.sleep(5)


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
