# Escrow path operator (story 6.07, EP-02 / EP-03 preconditions)

Stands up QA agents that UAT owns: a fresh operator key, agents registered on
the deployed AgentRegistry and owned by that key, each bound to an operator
endpoint, then checked from three sources (the registry's `owner_of`, the
API's binding, the API's readiness probe). It also finds intents the live
planner routes to those agents, without authorizing or executing anything.

It registers agents on testnet, so it is a tool to run by hand, not a CI step.

## Commands

```sh
export OPERATOR_STATE=/path/outside/the/repo   # holds operator.json (the secret); refused inside the repo
PY="$BACKEND/.venv/Scripts/python.exe"         # Orizon-Agents-BE-Stellar's venv: httpx + stellar_sdk
T=tools/escrow-path-operator/qa_operator.py

$PY $T fund
$PY $T register qa607_ok "Roman numeral converter (UAT QA): converts integers to Roman numerals" romannumerals,numberconversion 0.01
$PY $T bind qa607_ok https://<endpoint A>
$PY $T check qa607_ok https://<endpoint A>
$PY $T plan single "Convert the year 2026 into Roman numerals."
$PY $T plan pair "Convert the year 2026 into Roman numerals, then encode that Roman numeral text into Morse code."
$PY $T publish                                 # writes $OPERATOR_STATE/ops/agents.json, no secret
```

| Variable | Default | Meaning |
|---|---|---|
| `OPERATOR_STATE` | (required) | State directory outside the repository. |
| `OPERATOR_API` | `https://orizon-agents-be-stellar.onrender.com` | The deployed backend. |
| `OPERATOR_OK_ID` / `OPERATOR_HANG_ID` | `qa607_ok` / `qa607_hang` | The agents `plan` matches against. |
| `SSL_CERT_FILE` | unset | A CA bundle, when TLS is intercepted on the way out. |

Every refusal exits 1 with `refused: <reason>`; a usage error exits 2.

## Tests

```sh
PYTHONDONTWRITEBYTECODE=1 $PY -m pytest tools/escrow-path-operator -q -p no:cacheprovider
```

They run offline: refusals before any request, the SEP-53 signature the bind
sends, plan matching, and the hand-off file's shape.
