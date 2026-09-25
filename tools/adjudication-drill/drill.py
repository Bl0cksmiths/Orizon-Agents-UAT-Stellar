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
import subprocess
import sys
import time
from http.client import HTTPConnection
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


def http(method: str, path: str, body: object = None, *, headers: dict | None = None, raw: bytes | None = None, timeout: float = 180) -> tuple[int, dict]:
    """One request to the drill's backend. http.client sends header values and bodies exactly as
    given — bytes included — where urllib would re-encode them or refuse. An error status is an
    answer, not an exception; a body that is not JSON comes back as {"text": ...}."""
    data = raw if raw is not None else b"" if body is None else json.dumps(body).encode()
    conn = HTTPConnection("127.0.0.1", PORT, timeout=timeout)
    try:
        conn.putrequest(method, path)
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            conn.putheader(key, value)
        conn.endheaders(data)
        res = conn.getresponse()
        status, text = res.status, res.read()
    finally:
        conn.close()
    try:
        return status, json.loads(text or b"{}")
    except ValueError:
        return status, {"text": text.decode("utf-8", "replace")}


def launch(env: dict[str, str], label: str) -> tuple[subprocess.Popen, Path]:
    """`uvicorn app.main:app` in the backend checkout, as Render starts it, with only `env`
    beyond what Windows needs to run a process at all. Output goes to logs/ad-<label>.log."""
    try:
        http("GET", "/health", timeout=5)
    except OSError:
        pass
    else:
        raise RuntimeError(f"something already answers on port {PORT}; stop it or set DRILL_PORT")
    log = LOGS / f"ad-{label}.log"
    keep = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "PATH", "TEMP", "TMP", "USERPROFILE", "HOME"}}
    with log.open("w", encoding="utf-8") as out:
        proc = subprocess.Popen(
            [PYTHON, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT), "--workers", "1"],
            cwd=BACKEND,
            env={**keep, **env},
            stdout=out,
            stderr=subprocess.STDOUT,
        )
    return proc, log


REFUSAL = "API_KEY is required because"
MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015"


def mainnet_env(name: str) -> dict[str, str]:
    """Refunds on and API_KEY empty on a mainnet-named network, with no signing key: a
    read-only deployment, the one case where only the refund switch can make the key required."""
    env = backend_env(refunds=True, api_key="")
    del env["STELLAR_SIGNING_KEY"]
    env.update(STELLAR_NETWORK=name, STELLAR_NETWORK_PASSPHRASE=MAINNET_PASSPHRASE, STELLAR_RPC_URL="https://mainnet.sorobanrpc.com")
    return env


def refused_boot(label: str, env: dict[str, str]) -> str:
    """Boot with `env`, watching /health the whole time; returns the refusal line it printed."""
    proc, log = launch(env, "boot-" + "".join(c if c.isalnum() else "-" for c in label))
    answered: list[int] = []
    deadline = time.time() + 600
    while proc.poll() is None and time.time() < deadline:
        try:
            answered.append(http("GET", "/health", timeout=5)[0])
        except OSError:
            time.sleep(0.5)
    if proc.poll() is None:
        proc.kill()
        proc.wait(timeout=30)
    out = log.read_text(encoding="utf-8", errors="replace")
    line = next((row.strip() for row in out.splitlines() if REFUSAL in row), "")
    check(f"AD-02 {label}: uvicorn exits non-zero", proc.returncode not in (None, 0), f"exit {proc.returncode}")
    check(f"AD-02 {label}: it never answered /health", not answered, f"answers {answered}" if answered else "no answer")
    check(f"AD-02 {label}: its output names API_KEY", line.startswith("- " + REFUSAL), f"quoted: {line!r}" if line else f"see {log}")
    check(f"AD-02 {label}: the refusal prints no configured value", FIX["settler"]["secret"] not in out and DSN not in out)
    return line


def ad02_boot_refusal() -> None:
    """AD-02 refunds on and no API_KEY: the process refuses to boot and says why."""
    unset = refused_boot("testnet, API_KEY unset", backend_env(refunds=True, api_key=None))
    empty = refused_boot("testnet, API_KEY empty", backend_env(refunds=True, api_key=""))
    check("AD-02 unset and empty API_KEY are refused with the same words", unset == empty != "")
    for name in ("mainnet", "public", "pubnet"):
        refused_boot(f"{name}, API_KEY empty, no signing key", mainnet_env(name))


SCENARIOS = [ad02_boot_refusal]


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
