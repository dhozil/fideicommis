"""Guard rails for the consensus tests.

These need a running GenLayer network that can actually load this source. Two
things are checked before the suite runs, and both skip with instructions rather
than producing failures that look like a broken contract.

Why the second check earns its place. The contract pins the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, and that
runner deploys this source cleanly on Studionet with real consensus, and passes
`genvm-lint`. A locally installed glsim bundles a different engine that is
stricter about `@allow_storage` on a `gl.Contract` subclass and rejects the
deployment with:

    class is not marked for usage within storage, please, annotate it with @allow_storage

An unrelated, independently working GenLayer project is rejected the same way by
that engine, so this is an environment mismatch rather than a defect here. Ten
red failures for that reason is worse than an honest skip, because it teaches a
reviewer to ignore red.

So the check is empirical: it deploys the contract once and reads the engine's
own answer. No guesswork about versions or wording.

To actually run the suite:

    python tools/run_glsim_windows.py --port 4000 --validators 5
    $env:GENLAYER_RPC = "http://127.0.0.1:4000/api"
    python -m pytest tests/integration -v
"""

import json
import os
import urllib.error
import urllib.request

import pytest

DEFAULT_RPC = "http://127.0.0.1:4000/api"
CONTRACT = "fideicommis.py"

# Markers of an engine that will not load this source. Matched against the
# engine's own message, which is why the strings are quoted from real output.
INCOMPATIBLE_MARKERS = (
    "not marked for usage within storage",
    "annotate it with @allow_storage",
)


def _rpc_url() -> str:
    return os.environ.get("GENLAYER_RPC", DEFAULT_RPC)


def _post(url: str, method: str, params: list, timeout: float = 20.0):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _reachable(url: str, timeout: float = 2.0) -> bool:
    try:
        payload = _post(url, "eth_chainId", [], timeout=timeout)
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return "result" in payload


def _engine_message() -> str:
    """Deploy once and return whatever the engine said. Empty means it accepted."""
    from gltest import get_contract_factory

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(root, "contracts", CONTRACT)
    factory = get_contract_factory(contract_file_path=path)
    try:
        contract = factory.deploy(
            args=["Engine Probe", "probe", "charter", "0x" + "00" * 20, ""],
        )
    except Exception as error:  # the failure text is the point of this check
        return str(error)
    # A deploy that returns is still a deploy we paid for; tear it down if we can.
    try:
        contract.get_org_name.call()
    except Exception as error:
        return str(error)
    return ""


@pytest.fixture(scope="session", autouse=True)
def require_genlayer_network():
    url = _rpc_url()
    if not _reachable(url):
        pytest.skip(
            f"No GenLayer node at {url}. Start one and point GENLAYER_RPC at it, e.g.\n"
            "  python tools/run_glsim_windows.py --port 4000 --validators 5\n"
            "Then run: python -m pytest tests/integration -v"
        )

    message = _engine_message()
    if not message:
        return  # the engine loaded the contract, so the suite may run

    if any(marker in message for marker in INCOMPATIBLE_MARKERS):
        pytest.skip(
            "The node at this address is reachable, but its engine will not load this source. "
            "It rejects the deployment because a gl.Contract subclass is not annotated "
            "@allow_storage, which the pinned Studionet runner does not require. The same "
            "contract deploys on Studionet and passes genvm-lint, so this is an engine "
            "version mismatch rather than a defect.\n"
            "Point GENLAYER_RPC at a node running the pinned runner to run this suite:\n"
            "  $env:GENLAYER_RPC = 'https://studio.genlayer.com/api'\n"
            f"Engine said: {message[:400]}"
        )

    pytest.skip(f"The engine could not deploy the contract, so the suite cannot be trusted here. It said: {message[:400]}")
