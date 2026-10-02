"""Offline checks of the operator tool's refusals: every one stops before a key, a byte or a request leaves.

"$BACKEND/.venv/Scripts/python.exe" -m pytest tools/escrow-path-operator -q -p no:cacheprovider
"""

from pathlib import Path

import pytest
import qa_operator


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
