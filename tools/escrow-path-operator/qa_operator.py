"""Story 6.07: the QA agents UAT owns for the escrow v2 payment path (EP-02, EP-03).

    python qa_operator.py fund                a NEW operator key in $OPERATOR_STATE, funded by friendbot

The operator's secret lives only in $OPERATOR_STATE/operator.json, which must be
outside the repository. Everything else this tool writes holds public keys, ids,
hashes and observed answers, never a secret.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from stellar_sdk import Keypair

REPO = Path(__file__).resolve().parents[2]
FRIENDBOT = "https://friendbot.stellar.org"
DEFAULT_API = "https://orizon-agents-be-stellar.onrender.com"


class Refused(Exception):
    """The command stopped before or instead of a step; the message says why."""


def state_dir() -> Path:
    """$OPERATOR_STATE, refused when it is inside the repository: it holds a secret."""
    raw = os.environ.get("OPERATOR_STATE")
    if not raw:
        raise Refused("set OPERATOR_STATE to a directory outside the repository")
    path = Path(raw).resolve()
    if path == REPO or REPO in path.parents:
        raise Refused(f"OPERATOR_STATE {path} is inside the repository; it holds the operator's secret")
    path.mkdir(parents=True, exist_ok=True)
    return path


def http() -> httpx.Client:
    """One client for every call; it honours SSL_CERT_FILE for an intercepting proxy."""
    return httpx.Client(headers={"User-Agent": "orizon-uat-escrow-path-operator"}, follow_redirects=True)


def fund() -> int:
    """A fresh operator key, written to $OPERATOR_STATE/operator.json and funded by friendbot."""
    target = state_dir() / "operator.json"
    if target.exists():
        raise Refused(f"{target} exists; move it away to make a new operator")
    kp = Keypair.random()
    target.write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}), encoding="utf-8")
    response = http().get(FRIENDBOT, params={"addr": kp.public_key}, timeout=60.0)
    if not response.is_success:
        raise Refused(f"friendbot answered {response.status_code} for {kp.public_key}: {response.text[:300]}")
    print(f"operator {kp.public_key} funded by friendbot in {response.json()['hash']}")
    return 0


def load_operator() -> Keypair:
    source = state_dir() / "operator.json"
    if not source.exists():
        raise Refused(f"no operator in {source}; run `qa_operator.py fund` first")
    return Keypair.from_secret(json.loads(source.read_text(encoding="utf-8"))["secret"])


class Api:
    """The deployed API, called the way the dApp's operator console calls it."""

    def __init__(self, client: httpx.Client, base: str) -> None:
        self.client = client
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, *, body: Any = None, params: dict[str, str] | None = None) -> Any:
        """The JSON answer; any non-2xx is a refusal that quotes the API's own error code."""
        response = self.client.request(method, f"{self.base}{path}", json=body, params=params, timeout=105.0)
        if not response.is_success:
            raise Refused(f"{method} {path} answered {response.status_code}: {response.text[:300]}")
        return response.json()


def api() -> Api:
    return Api(http(), os.environ.get("OPERATOR_API", DEFAULT_API))


# name -> (command, how many positional arguments it takes)
COMMANDS: dict[str, tuple[Callable[..., int], int]] = {"fund": (fund, 0)}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in COMMANDS or len(argv) - 1 != COMMANDS[argv[0]][1]:
        print(__doc__, file=sys.stderr)
        return 2
    command, _ = COMMANDS[argv[0]]
    try:
        return command(*argv[1:])
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
