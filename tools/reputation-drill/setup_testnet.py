"""Testnet fixtures for the story 6.03e drill — the drill's own, nothing of the deployment's.

- three fresh friendbot accounts: the settler (ledger admin AND scorer, and the wallet credits
  are paid from), an asset issuer, and the buyer who pays and disputes;
- a NEW ReputationLedger instance created from the wasm the deployed ledger already runs (the
  same code, with no rebuild), constructed with the drill's settler as admin and scorer;
- a test asset UATUSD from the drill's issuer, its Stellar Asset Contract, trustlines for the
  settler and the buyer, and 100 UATUSD in the settler's wallet to pay credits from.

    DRILL_STATE=<a directory outside the repo> python setup_testnet.py

Writes $DRILL_STATE/rc-testnet.json, which holds the three secret keys: keep it out of git.
"""

import json
import os
import time
import urllib.request
from pathlib import Path

from stellar_sdk import Address, Asset, Keypair, Network, SorobanServer, TransactionBuilder, scval, xdr
from stellar_sdk import Server as Horizon

RPC = "https://soroban-testnet.stellar.org"
HORIZON = "https://horizon-testnet.stellar.org"
PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE
# The deployed testnet ReputationLedger (Orizon-Agents-Smart-Contract-Stellar addresses.json);
# only its wasm hash is read.
DEPLOYED_LEDGER = "CDCSOBEVZUPQZV5GV4D6KYHZCLNGW2KXY74RUHSZ3EZUXF34DPW422ZT"
OUT = Path(os.environ["DRILL_STATE"]).resolve() / "rc-testnet.json"

soroban = SorobanServer(RPC)
horizon = Horizon(HORIZON)


def fund(kp: Keypair) -> None:
    # friendbot answers urllib's default User-Agent with a 403.
    req = urllib.request.Request(f"https://friendbot.stellar.org/?addr={kp.public_key}", headers={"User-Agent": "orizon-uat"})
    urllib.request.urlopen(req, timeout=60).read()


def classic(source: Keypair, build) -> str:
    """One classic transaction from `source`, built by `build(tb)`, submitted through Horizon."""
    account = horizon.load_account(source.public_key)
    tb = TransactionBuilder(account, PASSPHRASE, base_fee=1000)
    build(tb)
    tx = tb.set_timeout(120).build()
    tx.sign(source)
    return horizon.submit_transaction(tx)["hash"]


def soroban_tx(source: Keypair, build) -> tuple[str, object]:
    """One Soroban transaction from `source`: simulated, signed, sent, and waited on until it lands."""
    account = soroban.load_account(source.public_key)
    tb = TransactionBuilder(account, PASSPHRASE, base_fee=100_000)
    build(tb)
    tx = soroban.prepare_transaction(tb.set_timeout(120).build())
    tx.sign(source)
    sent = soroban.send_transaction(tx)
    for _ in range(60):
        got = soroban.get_transaction(sent.hash)
        if got.status.value != "NOT_FOUND":
            if got.status.value != "SUCCESS":
                raise RuntimeError(f"{sent.hash}: {got.status}")
            return sent.hash, got
        time.sleep(2)
    raise RuntimeError(f"{sent.hash}: never confirmed")


def deployed_wasm_hash() -> bytes:
    """The wasm the deployed ledger runs, read off its instance entry.

    Built as an explicit LedgerKey: SorobanServer.get_contract_data returned nothing for this
    contract's instance on stellar_sdk 13.2.1.
    """
    key = xdr.LedgerKey(
        type=xdr.LedgerEntryType.CONTRACT_DATA,
        contract_data=xdr.LedgerKeyContractData(
            contract=Address(DEPLOYED_LEDGER).to_xdr_sc_address(),
            key=xdr.SCVal(xdr.SCValType.SCV_LEDGER_KEY_CONTRACT_INSTANCE),
            durability=xdr.ContractDataDurability.PERSISTENT,
        ),
    )
    entry = soroban.get_ledger_entries([key]).entries[0]
    return xdr.LedgerEntryData.from_xdr(entry.xdr).contract_data.val.instance.executable.wasm_hash.hash


def main() -> None:
    settler, issuer, buyer = Keypair.random(), Keypair.random(), Keypair.random()
    for kp in (settler, issuer, buyer):
        fund(kp)

    wasm_hash = deployed_wasm_hash()
    ledger_tx, got = soroban_tx(
        settler,
        lambda tb: tb.append_create_contract_op(
            wasm_id=wasm_hash,
            address=settler.public_key,
            constructor_args=[scval.to_address(settler.public_key), scval.to_address(settler.public_key)],
            salt=Keypair.random().raw_public_key(),
        ),
    )
    meta = xdr.TransactionMeta.from_xdr(got.result_meta_xdr)
    ledger_id = scval.from_address((meta.v4 or meta.v3).soroban_meta.return_value).address

    asset = Asset("UATUSD", issuer.public_key)
    classic(settler, lambda tb: tb.append_change_trust_op(asset))
    classic(buyer, lambda tb: tb.append_change_trust_op(asset))
    classic(issuer, lambda tb: tb.append_payment_op(settler.public_key, asset, "100"))
    sac_tx, _ = soroban_tx(settler, lambda tb: tb.append_create_stellar_asset_contract_from_asset_op(asset))

    state = {
        "settler": {"public": settler.public_key, "secret": settler.secret},
        "issuer": {"public": issuer.public_key, "secret": issuer.secret},
        "buyer": {"public": buyer.public_key, "secret": buyer.secret},
        "wasm_hash": wasm_hash.hex(),
        "reputation_ledger": ledger_id,
        "ledger_create_tx": ledger_tx,
        "asset": f"UATUSD:{issuer.public_key}",
        "asset_sac": asset.contract_id(PASSPHRASE),
        "sac_create_tx": sac_tx,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(state, indent=2))
    print(json.dumps({k: v for k, v in state.items() if not isinstance(v, dict)}, indent=2))


if __name__ == "__main__":
    main()
