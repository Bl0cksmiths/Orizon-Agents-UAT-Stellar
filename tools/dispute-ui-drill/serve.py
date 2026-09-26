"""The drill backend for browser.spec.ts: the 6.03e drill's backend on its ledger and asset, run
in this process with the operator key seed.py recorded and each seeded task's read token
registered, as /api/orchestrator/execute registers one for the tab that ran the task.

    python serve.py      after seed.py; listens on 127.0.0.1:8766
"""

import json
import os
import sys
from pathlib import Path

seed = json.loads((Path(os.environ["DRILL_STATE"]).resolve() / "ui-seed.json").read_text(encoding="utf-8"))
os.environ["DRILL_API_KEY"] = seed["apiKey"]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "reputation-drill"))
import drill as rc  # noqa: E402  (sets the backend's environment from the 6.03e fixtures)


def main() -> None:
    import uvicorn  # noqa: PLC0415

    os.chdir(rc.BACKEND)
    from app.main import app  # noqa: PLC0415
    from app.state import state  # noqa: PLC0415

    # seed.py keys everything by state name; the backend keys a token by its task id.
    state.task_tokens.update({seed["tasks"][name]: token for name, token in seed["tokens"].items()})
    uvicorn.run(app, host="127.0.0.1", port=rc.PORT, workers=1)


if __name__ == "__main__":
    main()
