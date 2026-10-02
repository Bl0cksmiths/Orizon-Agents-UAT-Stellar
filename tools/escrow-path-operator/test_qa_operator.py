"""Offline checks of the operator tool's refusals: every one stops before a key, a byte or a request leaves.

"$BACKEND/.venv/Scripts/python.exe" -m pytest tools/escrow-path-operator -q -p no:cacheprovider
"""

import json
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
