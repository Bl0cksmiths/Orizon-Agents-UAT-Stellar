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
