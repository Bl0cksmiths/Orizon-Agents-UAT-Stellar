"""Story 6.03g: the adjudication door and the refund switch, with refunds ON.

The deployed service runs with DISPUTE_REFUNDS_ENABLED off, and must stay that way, so every
case that needs the switch on is shown here instead: a backend checkout booted locally with
uvicorn, as Render runs it, once per configuration, on a real Postgres and on the testnet
fixtures of the 6.03e drill (tools/reputation-drill/setup_testnet.py) — its settler, its test
asset and its buyer. Nothing of the deployment's is touched, and no check here ever lets the
settler sign: the sequence number Horizon reports for it is read before and after, and must
not move.

    python drill.py              every case, printed as PASS / FAIL / XFAIL / XPASS
    python drill.py ad03 ad05    only the scenarios whose names start with these

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


def d074_mainnet_signer() -> None:
    """D-074 a signer on the mainnet passphrase needs API_KEY, whatever the network is called."""
    for name in ("mainnet", "pubnet"):
        env = backend_env(refunds=False, api_key="")
        env.update(STELLAR_NETWORK=name, STELLAR_NETWORK_PASSPHRASE=MAINNET_PASSPHRASE, STELLAR_RPC_URL="https://mainnet.sorobanrpc.com")
        proc, log = launch(env, f"boot-signer-{name}")
        served = False
        deadline = time.time() + 600
        while proc.poll() is None and not served and time.time() < deadline:
            try:
                served = http("GET", "/health", timeout=5)[0] == 200
            except OSError:
                time.sleep(0.5)
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=30)
        check(f"D-074 {name}: a mainnet signer with no API_KEY is refused at boot", not served,
              "it booted and served /health" if served else f"refused, exit {proc.returncode}", defect="D-074" if name == "pubnet" else None)


class Server:
    """A backend that booted: /health answered 200 before the constructor returned."""

    def __init__(self, label: str, env: dict[str, str]) -> None:
        self.proc, self.log = launch(env, label)
        deadline = time.time() + 600
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"the {label} backend exited {self.proc.returncode}; see {self.log}")
            try:
                if http("GET", "/health", timeout=5)[0] == 200:
                    return
            except OSError:
                time.sleep(0.5)
        self.stop()
        raise RuntimeError(f"the {label} backend did not come up in 10 minutes; see {self.log}")

    def stop(self) -> None:
        self.proc.kill()
        self.proc.wait(timeout=30)


def on_store(use):
    """Run `use(store)` against the Postgres dispute store, as a separate process would."""
    import asyncio

    from app.services import dispute_store

    async def run():
        store = dispute_store.PostgresDisputeStore(DSN)
        try:
            return await use(store)
        finally:
            await store.close()

    return asyncio.run(run())


def stored_status(dispute_id: str) -> str | None:
    record = on_store(lambda store: store.get_dispute(dispute_id))
    return None if record is None else record.status


AGENT = "agt_09l5"
STEP_PRICE = 0.1
SETTLED_TOTAL = 0.35


def open_dispute(label: str) -> str:
    """A settled two-step workflow paid by the drill's buyer, recorded as the settlement path
    records it, and step 0 disputed as the buyer disputes it: challenge, sign the exact message,
    open — with the wallet signature and nothing else, never an X-API-Key. Returns the id."""
    import base64

    from app.services import dispute_store as ds
    from stellar_sdk import Keypair

    buyer = Keypair.from_secret(FIX["buyer"]["secret"])
    job, now = secrets.token_hex(16), time.time()
    settlement = ds.SettlementRecord(
        task_id=f"ad-{secrets.token_hex(4)}",
        payer=buyer.public_key,
        auth_id_hex=secrets.token_hex(16),
        job_id_hex=job,
        charge_tx=secrets.token_hex(32),
        proof_tx=secrets.token_hex(32),
        settled_usdc=SETTLED_TOTAL,
        steps=(
            ds.SettlementStep(0, AGENT, "Researcher", STEP_PRICE, True, "Found three sources"),
            ds.SettlementStep(1, "agt_05x7", "SEO brief", SETTLED_TOTAL - STEP_PRICE, True, "Wrote the brief"),
        ),
        settled_at=now,
        window_closes_at=now + 86_400.0,
    )
    on_store(lambda store: store.record_settlement(settlement))
    status, challenge = http("POST", "/api/disputes/challenge", {"job_id_hex": job, "step_index": 0})
    check(f"{label}: the buyer's challenge is issued without a key", status == 200 and "message" in challenge, str(status))
    signature = base64.b64encode(buyer.sign(challenge["message"].encode("utf-8"))).decode("ascii")
    status, dispute = http(
        "POST",
        "/api/disputes",
        {
            "job_id_hex": job,
            "step_index": 0,
            "reason": "Story 6.03g: the research step returned nothing usable.",
            "payer": buyer.public_key,
            "nonce": challenge["nonce"],
            "signature_b64": signature,
        },
    )
    if not check(
        f"{label}: the dispute opens on the payer's signature alone",
        status == 200 and dispute.get("status") == "open",
        f"{status} {dispute.get('status') or dispute.get('error')}",
    ):
        raise RuntimeError(f"{label}: no open dispute to adjudicate")
    return dispute["id"]


def settler_sequence() -> int:
    """The settler's sequence number as testnet Horizon reports it. Every transaction the settler
    signs and submits moves it, so an unchanged number means nothing was signed in between."""
    from stellar_sdk import Server as Horizon

    return int(Horizon("https://horizon-testnet.stellar.org").accounts().account_id(FIX["settler"]["public"]).call()["sequence"])


def error_code(body: dict) -> str | None:
    return (body.get("error") or {}).get("code")


def untouched(tag: str, dispute_id: str, before: int) -> None:
    """After a batch of refusals: the settler signed nothing and the dispute is still open."""
    time.sleep(6)  # one ledger: a transaction signed during the refusals would be on Horizon by now
    after = settler_sequence()
    check(f"{tag} the settler signed nothing (Horizon sequence unchanged)", after == before, f"{before} -> {after}")
    _, read = http("GET", f"/api/disputes/{dispute_id}")
    store = stored_status(dispute_id)
    check(
        f"{tag} the dispute is still open, read through the API and the store",
        read.get("status") == store == "open",
        f"API {read.get('status')}, store {store}",
    )


REASON = "Story 6.03g: the step delivered three cited sources, so the brief was met."


def ad01_switch_closes_the_route() -> None:
    """AD-01 refunds off, the right key configured and sent: both decisions refused, nothing signed."""
    dispute_id = open_dispute("AD-01")
    before = settler_sequence()
    for route, body in (("uphold", None), ("reject", {"note": REASON})):
        status, answer = http("POST", f"/api/disputes/{dispute_id}/{route}", body, headers={"X-API-Key": API_KEY})
        check(
            f"AD-01 {route} with the right key: 503 dispute_refunds_disabled",
            status == 503 and error_code(answer) == "dispute_refunds_disabled",
            f"{status} {error_code(answer)}",
        )
    untouched("AD-01", dispute_id, before)


# Header values as they cross the wire: http.client sends bytes untouched, so the non-ASCII keys
# arrive exactly as a client that encodes them one way or the other would send them.
BAD_KEYS: list[tuple[str, str | bytes | None]] = [
    ("no X-API-Key", None),
    ("a wrong key", "ad-" + secrets.token_hex(12)),
    ("the right key minus its last character", API_KEY[:-1]),
    ("a non-ASCII key as UTF-8 bytes", ("kéy✓-" + API_KEY).encode("utf-8")),
    ("a non-ASCII key as latin-1 bytes", ("kéy-" + API_KEY).encode("latin-1")),
    # U+00A0 is whitespace to str.strip() and not to bytes.strip(); the guard must use the latter.
    ("the right key with a trailing latin-1 no-break space", (API_KEY + "\xa0").encode("latin-1")),
]


def ad03_bad_keys() -> None:
    """AD-03 refunds on, a key configured: every wrong key is 401 invalid_api_key, never a 500."""
    dispute_id = open_dispute("AD-03")
    before = settler_sequence()
    bodies = set()
    for route, body in (("uphold", None), ("reject", {"note": REASON})):
        for label, key in BAD_KEYS:
            status, answer = http("POST", f"/api/disputes/{dispute_id}/{route}", body, headers={} if key is None else {"X-API-Key": key})
            check(
                f"AD-03 {route} with {label}: 401 invalid_api_key", status == 401 and error_code(answer) == "invalid_api_key", f"{status} {error_code(answer)}"
            )
            bodies.add(json.dumps({**answer, "error": {k: v for k, v in (answer.get("error") or {}).items() if k != "request_id"}}, sort_keys=True))
    check("AD-03 every refusal reads the same: none says whether a key was sent", len(bodies) == 1, f"{len(bodies)} distinct bodies")
    untouched("AD-03", dispute_id, before)


def answered(status: int, body: dict) -> str:
    """Status, code and, for a validation error, the first failure's type — what a report quotes."""
    detail = body.get("detail")
    kind = detail[0].get("type") if isinstance(detail, list) and detail and isinstance(detail[0], dict) else None
    return f"{status} {error_code(body)}{f' ({kind})' if kind else ''}"


# (route, what is wrong with the body, the raw body); none of them carries a key.
BAD_BODIES = [
    ("uphold", "a well-formed body of the wrong shape", b'{"note": 5}'),
    ("uphold", "malformed JSON", b"{not json"),
    ("reject", "no body", b""),
    ("reject", "a body with no note", b"{}"),
    ("reject", "a well-formed body of the wrong shape", b'{"note": 5}'),
]


def ad04_guard_before_body() -> None:
    """AD-04 refunds on, no key: the guard answers before the body is read."""
    dispute_id = open_dispute("AD-04")
    before = settler_sequence()
    for route, label, raw in BAD_BODIES:
        status, body = http("POST", f"/api/disputes/{dispute_id}/{route}", raw=raw)
        check(f"AD-04 {route}, no key, {label}: the guard's 401, not 422", status == 401 and error_code(body) == "invalid_api_key", answered(status, body))
    status, body = http("POST", f"/api/disputes/{dispute_id}/reject", raw=b"{not json")
    check("AD-04 reject, no key, malformed JSON: never a 500", status < 500, answered(status, body))
    check(
        "AD-04 reject, no key, malformed JSON: the guard's 401, not 422",
        status == 401 and error_code(body) == "invalid_api_key",
        f"answered {answered(status, body)} before the guard",
        defect="D-073",
    )
    untouched("AD-04", dispute_id, before)


# (what the rejection says, its body, the code it must be refused with). The model refuses the
# shape; what is left after cleaning is the service's call, so whitespace passes the model and
# is refused there.
EMPTY_REASONS = [
    ("no note field", {}, "validation_error"),
    ("a null note", {"note": None}, "validation_error"),
    ("an empty note", {"note": ""}, "validation_error"),
    ("a note of whitespace", {"note": "   \t\n"}, "rejection_reason_required"),
    ("a note of control characters", {"note": "\x00\x1b\x7f"}, "rejection_reason_required"),
]


def ad05_rejection_needs_a_reason() -> None:
    """AD-05 refunds on, the right key: a rejection must tell the buyer why."""
    dispute_id = open_dispute("AD-05")
    before = settler_sequence()
    key = {"X-API-Key": API_KEY}
    for label, body, code in EMPTY_REASONS:
        status, answer = http("POST", f"/api/disputes/{dispute_id}/reject", body, headers=key)
        check(f"AD-05 a rejection with {label} is refused: 422 {code}", status == 422 and error_code(answer) == code, answered(status, answer))
    untouched("AD-05", dispute_id, before)
    status, answer = http("POST", f"/api/disputes/{dispute_id}/reject", {"note": REASON}, headers=key)
    check(
        "AD-05 a rejection with a reason succeeds, so the refusals were not a broken route",
        status == 200 and answer.get("status") == "rejected" and answer.get("rejection_reason") == REASON,
        f"{status} {answer.get('status')}",
    )
    check("AD-05 the store holds the rejection", stored_status(dispute_id) == "rejected", str(stored_status(dispute_id)))


def ad06_buyer_needs_no_key() -> None:
    """AD-06 refunds on, a key configured: the buyer's path asks for no key."""
    dispute_id = open_dispute("AD-06")
    check("AD-06 the store holds the dispute open", stored_status(dispute_id) == "open", str(stored_status(dispute_id)))


REFUNDS_OFF = ("refunds-off", backend_env(refunds=False, api_key=API_KEY))
REFUNDS_ON = ("refunds-on", backend_env(refunds=True, api_key=API_KEY))
# (server, scenario): consecutive scenarios with the same server share one boot; None boots none.
SCENARIOS = [
    (None, ad02_boot_refusal),
    (None, d074_mainnet_signer),
    (REFUNDS_OFF, ad01_switch_closes_the_route),
    (REFUNDS_ON, ad06_buyer_needs_no_key),
    (REFUNDS_ON, ad03_bad_keys),
    (REFUNDS_ON, ad04_guard_before_body),
    (REFUNDS_ON, ad05_rejection_needs_a_reason),
]


def main() -> None:
    """Every scenario, or only those whose names start with an argument (`drill.py ad03 ad05`)."""
    LOGS.mkdir(parents=True, exist_ok=True)
    chosen = [(srv, fn) for srv, fn in SCENARIOS if not sys.argv[1:] or fn.__name__.startswith(tuple(sys.argv[1:]))]
    if not chosen:
        sys.exit(f"no scenario is named {sys.argv[1:]}; they are {[fn.__name__ for _, fn in SCENARIOS]}")
    server, booted = None, None
    try:
        for config, scenario in chosen:
            if config is not booted:
                if server is not None:
                    server.stop()
                server, booted = None if config is None else Server(*config), config
            print(f"\n{scenario.__doc__.splitlines()[0]}", flush=True)
            scenario()
    finally:
        if server is not None:
            server.stop()
    failed = [r for r in results if r[1] in {"FAIL", "XPASS"}]
    expected = [r for r in results if r[1] == "XFAIL"]
    print(f"\n{len(results) - len(failed) - len(expected)} passed, {len(expected)} expected failures, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
