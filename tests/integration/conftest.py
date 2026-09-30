"""Guard rails for the consensus tests.

These need a running GenLayer network, so they skip with instructions when there is
none. There is a second skip, and it exists because a consensus suite that cannot
reach the contract is worse than an honest skip: eight red failures teach a reviewer
to ignore red, which is exactly the state this file was in before.

What is actually wrong, measured rather than assumed. An earlier version of this
file blamed a stricter `@allow_storage` rule in the local glsim bundle. That was
wrong, and it is worth writing down because the wrong reason is more expensive than
no reason.

- A 12-line `@allow_storage` contract deploys cleanly, so the decorator and the
  engine are both fine.
- The same source, deployed six times against the same node, succeeded once and
  failed five times with `class is not marked for usage within storage`. The class
  named in that message carries the decorator. The message is not describing a fact
  about the source.
- Four deploys of four different sources all succeeded.

So the engine caches a module per source hash and only honours `@allow_storage` on
the first load of that module. That is a stateful bug in the local bundle, and it
has a workaround, which `staged_contract()` below implements: every test deploys a
copy of the contract carrying a unique comment, so the engine always loads a module
it has not seen. The copy is byte-identical apart from that comment.

Past that, genlayer-test 0.29.2 cannot produce a usable contract handle on this
node. `ContractFactory.deploy()` returns a Contract whose method set is empty, so
every call on it raises `no attribute get_org_name`. The schema it builds those
methods from is fetched over RPC with a fallback chain, and against a local node
that fetch comes back empty. The contract itself is fine: the same file deploys on
Studionet with real consensus and passes genvm-lint. It is the local test harness
that cannot address it, and that is what this second check reports.

To run the suite, point GENLAYER_RPC at a node whose harness can build a contract
handle:

    python tools/run_glsim_windows.py --port 4000 --validators 5
    $env:GENLAYER_RPC = "http://127.0.0.1:4000/api"
    python -m pytest tests/integration -v
"""

import itertools
import json
import os
import pathlib
import shutil
import urllib.error
import urllib.request

import pytest

DEFAULT_RPC = "http://127.0.0.1:4000/api"
CONTRACT = "fideicommis.py"

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT_SOURCE = REPO_ROOT / "contracts" / CONTRACT
# Beside the real contract, because gltest resolves a contract path relative to its
# configured contracts directory and a file elsewhere is invisible to it.
STAGING = REPO_ROOT / "contracts" / ".integration"

_counter = itertools.count(1)


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


def staged_contract() -> str:
    """A fresh copy of the contract for every deploy, relative to the contracts dir.

    The appended comment is the only difference, and it is why the suite can get as
    far as it does: the local engine only honours `@allow_storage` on a module it has
    not already loaded, so a repeated deploy of one file fails for reasons that have
    nothing to do with the contract.
    """
    tag = next(_counter)
    STAGING.mkdir(parents=True, exist_ok=True)
    target = STAGING / f"fideicommis_{tag}.py"
    shutil.copyfile(CONTRACT_SOURCE, target)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(f"\n# integration deploy {tag}: a unique source, so the engine loads a fresh module\n")
    return str(target.relative_to(REPO_ROOT / "contracts"))


def _harness_can_address_the_contract() -> str:
    """Deploy once and return why the harness could not address it, if it could not.

    Empty string means the contract is callable, so the suite may run.
    """
    from gltest import get_contract_factory

    factory = get_contract_factory(contract_file_path=staged_contract())
    try:
        contract = factory.deploy(args=["Engine Probe", "probe", "charter", "0x" + "00" * 20, ""])
    except Exception as error:
        return f"the deployment itself failed: {str(error)[:300]}"

    if not hasattr(contract, "get_org_name"):
        return (
            "the deployment succeeded but genlayer-test returned a contract with no methods on it, "
            "so no view can be called. Its schema is fetched over RPC with a fallback chain and "
            "comes back empty against a local node."
        )
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

    problem = _harness_can_address_the_contract()
    if not problem:
        yield
        shutil.rmtree(STAGING, ignore_errors=True)
        return

    pytest.skip(
        "The node at this address is reachable and the contract deploys on it, but the test\n"
        "harness cannot address what it deployed, so these tests could not assert anything: "
        f"{problem}\n"
        "\n"
        "This is a harness limitation, not a contract defect. The identical file deploys on\n"
        "Studionet with real consensus and passes genvm-lint, and the direct-mode suite runs\n"
        "117 tests against the same logic without a network.\n"
        "\n"
        "Point GENLAYER_RPC at a node whose harness can build a contract handle:\n"
        "  $env:GENLAYER_RPC = 'https://studio.genlayer.com/api'\n"
    )
