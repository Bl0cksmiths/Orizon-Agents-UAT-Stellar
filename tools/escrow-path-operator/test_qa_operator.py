"""Offline checks of the operator tool's refusals: every one stops before a key, a byte or a request leaves.

"$BACKEND/.venv/Scripts/python.exe" -m pytest tools/escrow-path-operator -q -p no:cacheprovider
"""

import base64
import json
import os
from pathlib import Path
from typing import Any

import httpx
import pytest
import qa_operator
from stellar_sdk import Keypair


def test_state_dir_refuses_unset_and_in_repo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPERATOR_STATE", raising=False)
    with pytest.raises(qa_operator.Refused, match="set OPERATOR_STATE"):
        qa_operator.state_dir()
    monkeypatch.setenv("OPERATOR_STATE", str(qa_operator.REPO / "tools"))
    with pytest.raises(qa_operator.Refused, match="inside the repository"):
        qa_operator.state_dir()
    monkeypatch.setenv("OPERATOR_STATE", str(qa_operator.REPO))
    with pytest.raises(qa_operator.Refused, match="inside the repository"):
        qa_operator.state_dir()


def test_state_dir_accepts_outside_repo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPERATOR_STATE", str(tmp_path / "state"))
    assert qa_operator.state_dir() == (tmp_path / "state").resolve()
    assert (tmp_path / "state").is_dir()


@pytest.mark.parametrize(
    ("agent_id", "skills", "price", "reason"),
    [
        ("qa607-ok", "romannumerals", "0.01", "not a Soroban Symbol"),
        ("a" * 33, "romannumerals", "0.01", "not a Soroban Symbol"),
        ("agt_qa607", "romannumerals", "0.01", "agt_ namespace"),
        ("qa607_ok", "roman-numerals", "0.01", "skill 'roman-numerals'"),
        ("qa607_ok", "romannumerals", "ten", "not a number"),
        ("qa607_ok", "romannumerals", "0", "outside"),
        ("qa607_ok", "romannumerals", "0.06", "outside"),
    ],
)
def test_register_refuses_before_any_request(agent_id: str, skills: str, price: str, reason: str) -> None:
    with pytest.raises(qa_operator.Refused, match=reason):
        qa_operator.register(agent_id, "QA agent", skills, price)


@pytest.fixture
def operator_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Keypair:
    """A throwaway operator in a temporary state dir; nothing is funded."""
    kp = Keypair.random()
    monkeypatch.setenv("OPERATOR_STATE", str(tmp_path))
    (tmp_path / "operator.json").write_text(json.dumps({"public_key": kp.public_key, "secret": kp.secret}))
    return kp


def backend(monkeypatch: pytest.MonkeyPatch, answers: dict[str, Any]) -> list[str]:
    """Answer the tool's API calls from `answers` (path -> JSON); returns the paths requested, in order."""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json=answers[request.url.path])

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(qa_operator, "api", lambda: qa_operator.Api(client, "https://api.test"))
    return seen


def test_bind_refuses_plain_http(operator_state: Keypair) -> None:
    with pytest.raises(qa_operator.Refused, match="not an https URL"):
        qa_operator.bind("qa607_ok", "http://example.com")


def test_bind_stops_at_the_endpoint_check(operator_state: Keypair, monkeypatch: pytest.MonkeyPatch) -> None:
    refusal = {"allowed": False, "rule": "non_public_address", "message": "loopback"}
    seen = backend(monkeypatch, {"/api/agents/bind/endpoint-check": refusal})
    with pytest.raises(qa_operator.Refused, match="rule non_public_address"):
        qa_operator.bind("qa607_ok", "https://127.0.0.1/")
    assert seen == ["/api/agents/bind/endpoint-check"]


def test_bind_signs_the_challenge_per_sep53(operator_state: Keypair, monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://agent.example.com"
    message = f"orizon-bind:v1:qa607_ok:{url}:nonce1"
    seen = backend(
        monkeypatch,
        {
            "/api/agents/bind/endpoint-check": {"allowed": True, "rule": None, "message": None},
            "/api/agents/qa607_ok/bind/challenge": {"message": message, "expires_at": 2.0},
            "/api/agents/qa607_ok/bind": {
                "endpoint_url": url,
                "owner": operator_state.public_key,
                "bound_at": 1.0,
                "replaced": False,
            },
        },
    )
    signed: list[dict[str, str]] = []
    real_call = qa_operator.Api.call

    def spy(self: qa_operator.Api, method: str, path: str, **kw: Any) -> Any:
        if path.endswith("/bind"):
            signed.append(kw["body"])
        return real_call(self, method, path, **kw)

    monkeypatch.setattr(qa_operator.Api, "call", spy)
    assert qa_operator.bind("qa607_ok", url) == 0
    assert seen[-1] == "/api/agents/qa607_ok/bind"
    operator_state.verify_message(message, base64.b64decode(signed[0]["signature"]))
    recorded = json.loads((Path(os.environ["OPERATOR_STATE"]) / "operator-run.json").read_text())
    assert recorded["agents"]["qa607_ok"]["endpoint"] == url


def decomposed(*agent_ids: str) -> dict[str, Any]:
    steps = [{"agent_id": a, "agent_name": a, "est_price_usdc": 0.01} for a in agent_ids]
    return {"plan_id": "pln_test", "steps": steps, "total_usdc": 0.01 * len(steps), "notices": []}


@pytest.mark.parametrize(
    ("kind", "agent_ids", "fits"),
    [
        ("single", ["qa607_ok"], True),
        ("single", ["qa607_ok", "agt_05x7"], False),
        ("single", [], False),
        ("pair", ["qa607_ok", "qa607_hang"], True),
        ("pair", ["qa607_hang", "qa607_ok"], True),
        ("pair", ["qa607_ok", "qa607_ok"], False),
        ("pair", ["qa607_ok", "qa607_hang", "agt_05x7"], False),
    ],
)
def test_plan_keeps_only_a_fitting_plan(
    operator_state: Keypair, monkeypatch: pytest.MonkeyPatch, kind: str, agent_ids: list[str], fits: bool
) -> None:
    backend(monkeypatch, {"/api/orchestrator/decompose": decomposed(*agent_ids)})
    if fits:
        assert qa_operator.plan(kind, "an intent") == 0
    else:
        with pytest.raises(qa_operator.Refused, match=f"not a {kind} plan"):
            qa_operator.plan(kind, "an intent")
    run = qa_operator.load_run()
    assert run["attempts"][-1]["fits"] is fits
    assert (kind in run["intents"]) is fits
