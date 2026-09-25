"""Restart drill for story 6.03d — durability tested by restarting, not by reasoning.

Runs a real backend process (uvicorn) against a real Postgres, kills it, starts
it again, and compares what the API answers on each side of the restart.
Settlements are seeded through the backend's own store, as the settlement path
writes them; disputes are opened over HTTP with a real payer signature.

    DRILL_BACKEND=<backend checkout> DRILL_DSN=postgresql://... python drill.py [scenario ...]

Run it with the backend's own interpreter (its virtualenv has uvicorn, asyncpg
and stellar_sdk). See README.md beside this file.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

BACKEND = Path(os.environ["DRILL_BACKEND"]).resolve()
DSN = os.environ["DRILL_DSN"]
PORT = int(os.environ.get("DRILL_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
LOGS = Path(os.environ.get("DRILL_LOGS", "logs")).resolve()
PYTHON = os.environ.get("DRILL_PYTHON", sys.executable)

# (name, verdict, detail); verdict is PASS, FAIL, XFAIL or XPASS.
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", *, defect: str | None = None) -> bool:
    """Record one assertion. A check pinned to an open defect is expected to fail:
    it reads XFAIL while the defect stands and XPASS — a failure of the drill —
    the moment it is fixed, so the pin has to be removed rather than forgotten."""
    if defect is None:
        verdict = "PASS" if ok else "FAIL"
    else:
        verdict = "XPASS" if ok else "XFAIL"
        detail = f"{defect}{' — ' + detail if detail else ''}"
    results.append((name, verdict, detail))
    print(f"  [{verdict}] {name}{' — ' + detail if detail else ''}", flush=True)
    return ok


def http(method: str, path: str, body: dict | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    """One JSON request to the drill's backend; an error status is an answer, not an exception."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


SCENARIOS: dict[str, Callable[[], None]] = {}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(SCENARIOS):
        SCENARIOS[name]()
    failed = [r for r in results if r[1] in {"FAIL", "XPASS"}]
    expected = [r for r in results if r[1] == "XFAIL"]
    print(f"\n{len(results) - len(failed) - len(expected)} passed, {len(expected)} expected failures, {len(failed)} failed")
    sys.exit(1 if failed else 0)
