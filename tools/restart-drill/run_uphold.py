"""Run the backend's scripts/uphold_dispute.py with the chain's answer to the transfer replaced.

The one substitution is `refund_svc.execute_refund`, the SAC transfer call. It
answers the way `invoke_with_server_key_async` answers a submission it lost
track of — `{"status": "timeout", "hash": ...}` — and appends one line to
DRILL_TRANSFER_CALLS each time it is asked, so the drill can count signatures.
Nothing is signed and nothing reaches a network; everything else is the real
script, the real service and the real store.

    DRILL_BACKEND=... DRILL_TRANSFER_CALLS=... DRILL_TX_HASH=... python run_uphold.py --dispute-id dsp_...
"""

import os
import runpy
import sys
from pathlib import Path

backend = Path(os.environ["DRILL_BACKEND"]).resolve()
calls = Path(os.environ["DRILL_TRANSFER_CALLS"])
sys.path.insert(0, str(backend))

from app.services import refund_svc  # noqa: E402


async def _timed_out_transfer(buyer: str, amount_usdc: float) -> dict:
    with calls.open("a", encoding="utf-8") as f:
        f.write(f"{buyer} {amount_usdc:.7f}\n")
    return {"status": "timeout", "hash": os.environ["DRILL_TX_HASH"]}


refund_svc.execute_refund = _timed_out_transfer
sys.argv = [str(backend / "scripts" / "uphold_dispute.py"), *sys.argv[1:]]
runpy.run_path(sys.argv[0], run_name="__main__")
