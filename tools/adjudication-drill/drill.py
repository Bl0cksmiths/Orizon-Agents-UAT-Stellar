"""Story 6.03g: the adjudication door and the refund switch, with refunds ON.

The deployed service runs with DISPUTE_REFUNDS_ENABLED off, and must stay that way, so every
case that needs the switch on is shown here instead: a backend checkout booted locally with
uvicorn, as Render runs it, once per configuration, on a real Postgres and on the testnet
fixtures of the 6.03e drill (tools/reputation-drill/setup_testnet.py) — its settler, its test
asset and its buyer. Nothing of the deployment's is touched, and no check here ever lets the
settler sign: the sequence number Horizon reports for it is read before and after, and must
not move.

    python drill.py      every case, printed as PASS / FAIL / XFAIL / XPASS

Environment: DRILL_STATE (the directory setup_testnet.py wrote), DRILL_BACKEND (a backend
checkout), DRILL_DSN (a Postgres the drill may write to), DRILL_PYTHON (the backend's
interpreter), DRILL_PORT (default 8767). REQUESTS_CA_BUNDLE and SSL_CERT_FILE are passed
through for a machine whose TLS is intercepted.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

STATE = Path(os.environ["DRILL_STATE"]).resolve()
FIX = json.loads((STATE / "rc-testnet.json").read_text())
BACKEND = Path(os.environ["DRILL_BACKEND"]).resolve()
DSN = os.environ["DRILL_DSN"]
PYTHON = os.environ.get("DRILL_PYTHON", sys.executable)
LOGS = STATE / "logs"
PORT = int(os.environ.get("DRILL_PORT", "8767"))
# The operator key of every server that has one: random per run and local only.
API_KEY = "ad-" + secrets.token_hex(12)


def backend_env(*, refunds: bool, api_key: str | None) -> dict[str, str]:
    """The backend's environment on the drill's fixtures; `api_key=None` leaves API_KEY unset."""
    env = {
        "DATABASE_URL": DSN,
        "STELLAR_NETWORK": "testnet",
        "STELLAR_RPC_URL": "https://soroban-testnet.stellar.org",
        "STELLAR_NETWORK_PASSPHRASE": "Test SDF Network ; September 2015",
        "STELLAR_REPUTATION_LEDGER": FIX["reputation_ledger"],
        "STELLAR_ASSET_SAC": FIX["asset_sac"],
        "STELLAR_SIGNING_KEY": FIX["settler"]["secret"],
        "STELLAR_ADMIN_ADDRESS": FIX["settler"]["public"],
        "STELLAR_AGENT_REGISTRY": "",
        "STELLAR_PAYMENT_ESCROW": "CBJPTMAPMGODGZCZ2IMEQSRUX3WGUXNMKDTNN2KMJ3NFGYZ5OJ5525PI",
        "STELLAR_ATTESTATION_REGISTRY": "CBYUZKOET43UXTBXZUJIBBJW5ODGD2J2AZVVXCR3QONGOCAHOXQQHEGK",
        "DISPUTE_REFUNDS_ENABLED": "true" if refunds else "false",
        "PYTHONIOENCODING": "utf-8",
        **{k: os.environ[k] for k in ("REQUESTS_CA_BUNDLE", "SSL_CERT_FILE") if k in os.environ},
    }
    if api_key is not None:
        env["API_KEY"] = api_key
    return env


# This process reads the store and signs the buyer's challenges with the backend's own code,
# so it loads the backend's settings too: the refunds-on configuration, which is a valid one.
os.environ.update(backend_env(refunds=True, api_key=API_KEY))
sys.path.insert(0, str(BACKEND))

# (name, verdict, detail); verdict is PASS, FAIL, XFAIL or XPASS.
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", *, defect: str | None = None) -> bool:
    """Record one assertion. One pinned to an open defect reads XFAIL while the defect stands
    and XPASS — a failure of the drill — once it is fixed, so the pin must come off."""
    if defect is None:
        verdict = "PASS" if ok else "FAIL"
    else:
        verdict = "XPASS" if ok else "XFAIL"
        detail = f"{defect}{' — ' + detail if detail else ''}"
    results.append((name, verdict, detail))
    print(f"  [{verdict}] {name}{' — ' + detail if detail else ''}", flush=True)
    return ok


SCENARIOS: list = []


def main() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    for scenario in SCENARIOS:
        print(f"\n{scenario.__doc__.splitlines()[0]}", flush=True)
        scenario()
    failed = [r for r in results if r[1] in {"FAIL", "XPASS"}]
    expected = [r for r in results if r[1] == "XFAIL"]
    print(f"\n{len(results) - len(failed) - len(expected)} passed, {len(expected)} expected failures, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
