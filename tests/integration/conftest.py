"""Guard rails for the consensus tests.

These need a running GenLayer network. They run against Studionet, and they skip
with instructions when there is none. This file's earlier versions claimed two
things that measurement contradicted, so both are recorded here, because the wrong
reason cost this project its entire consensus suite.

**"gltest cannot reach Studionet, User-Agent filtering."**

The mechanism is real and the conclusion is not. Cloudflare in front of
https://studio.genlayer.com/api answers error 1010, "banned based on your browser's
signature", to a request whose User-Agent it does not recognise. But gltest goes
through `requests`, which is one it accepts. Measured against the live endpoint:

    urllib, no User-Agent set       -> 403 error code: 1010
    urllib, Python-urllib/3.12      -> 403 error code: 1010
    urllib, python-requests/2.32    -> 200 0xf22f
    requests, its own default UA    -> 200 0xf22f

What could not get through was this file's own hand-rolled `urllib` probe, and since
the probe was the only thing between the suite and the network, the project recorded
a limitation that its own dependency did not have. `_post` now uses `requests`.

**"A local glsim bundle is stricter about @allow_storage than the pinned runner."**

Also false, and it was hiding a different bug. A 12-line @allow_storage contract
deploys cleanly on the local bundle. The same source deployed six times against the
same node succeeded once and failed five times, naming a class that carries the
decorator. Four different sources all deployed. So the local engine caches a module
per source hash and only honours @allow_storage on the first load of it: a stateful
bug, and `staged_contract()` below works around it by giving every test a unique
copy of the contract.

A third defect is real and is not worked around: genlayer-test's
`ContractFactory.deploy()` builds the returned handle's methods from a schema it
fetches over RPC through a fallback chain, and against a local node that fetch comes
back empty, so the handle has no methods on it. `test_consensus.deploy_trust` builds
the handle from the factory's schema directly and then asserts the methods are
really there, which fails loudly rather than as a confusing `no attribute
get_org_name` on the first view call. On Studionet the deploy is fine either way.

To run the suite, the way GenLayer documents it:

    gltest tests/integration -v -s --network studionet

    # and the ones that call real models and take minutes each
    gltest tests/integration -v -s -m slow --network studionet

The network presets have different chain IDs and deployments, and GenLayer is
explicit that a release-candidate environment must not be reached by relabelling the
stable one, so the preset is chosen on the command line and nothing here overrides
it. `gltest.config.yaml` in the repository root sets only the contracts directory:
declaring a `networks:` block there REPLACES the presets rather than extending them,
which was also measured.
"""

import itertools
import os
import pathlib
import shutil
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT_SOURCE = REPO_ROOT / "contracts" / "fideicommis.py"
# Beside the real contract, because gltest resolves a contract path relative to its
# configured contracts directory and a file elsewhere is invisible to it.
STAGING = REPO_ROOT / "contracts" / ".integration"

_counter = itertools.count(1)


def _rpc_url() -> str:
    """The network the suite is pointed at, which is gltest's own configuration.

    An earlier version read GENLAYER_RPC and defaulted to 127.0.0.1:4000. That made
    the suite unreachable from the documented invocation, because
    `gltest --network studionet` sets the network inside gltest's config and never
    touches the environment variable. The URL is asked for from the same place gltest
    asks, and GENLAYER_RPC is only an override for endpoints the presets do not
    cover.
    """
    override = os.environ.get("GENLAYER_RPC")
    if override:
        return override
    try:
        from gltest_cli.config.general import get_general_config

        url = get_general_config().get_rpc_url()
        if url:
            return str(url)
    except Exception:
        pass
    return "https://studio.genlayer.com/api"


def _post(url: str, method: str, params: list, timeout: float = 20.0):
    """One JSON-RPC call for the reachability check. See the module docstring."""
    import requests

    response = requests.post(
        url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def _reachable(url: str, timeout: float = 15.0) -> bool:
    try:
        payload = _post(url, "eth_chainId", [], timeout=timeout)
    except Exception:
        return False
    return "result" in payload


def staged_contract() -> str:
    """A fresh copy of the contract for every deploy, relative to the contracts dir.

    The appended comment is the only difference. On Studionet it is harmless, and on
    a local node it is the difference between running and not: the local engine only
    honours `@allow_storage` on a module it has not already loaded, so a repeated
    deploy of one file fails for reasons that have nothing to do with the contract.
    """
    tag = next(_counter)
    STAGING.mkdir(parents=True, exist_ok=True)
    target = STAGING / f"fideicommis_{tag}.py"
    shutil.copyfile(CONTRACT_SOURCE, target)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n# integration deploy {tag}: a unique source, so the engine loads a fresh module\n"
        )
    return str(target.relative_to(REPO_ROOT / "contracts"))


def _gltest_cli_is_in_charge() -> bool:
    """True when the `gltest` CLI is driving this run, rather than plain pytest.

    Studio mode needs the CLI. The network and the config are not the reason, because
    genlayer-test's pytest plugin loads gltest.config.yaml either way and reports the
    same contracts directory and the same localnet URL under both invocations. What
    actually differs is the entry point: `gltest` on argv[0] against
    pytest/__main__.py. That is the whole test, and it is checked rather than assumed
    because a plain `pytest` run cannot deploy here, and would otherwise fail eight
    times for a reason that has nothing to do with the contract.
    """
    return pathlib.Path(sys.argv[0]).stem.lower() == "gltest"


@pytest.fixture(scope="session", autouse=True)
def require_genlayer_network():
    if not _gltest_cli_is_in_charge():
        pytest.skip(
            "These run through the gltest CLI, which loads gltest.config.yaml and picks the\n"
            "network. Plain pytest cannot deploy in Studio mode, so it is not the command:\n"
            "\n"
            "  gltest tests/integration -v -s --network studionet\n"
            "\n"
            "The direct-mode suite, which is most of this repository, runs under plain pytest:\n"
            "  python -m pytest -q"
        )

    url = _rpc_url()
    if not _reachable(url):
        pytest.skip(
            f"No GenLayer node answered at {url}. Point the suite at one:\n"
            "  gltest tests/integration -v -s --network studionet\n"
            "Or start a local one:\n"
            "  python tools/run_glsim_windows.py --port 4000 --validators 5\n"
            "and pass GENLAYER_RPC=http://127.0.0.1:4000/api"
        )
    yield
    shutil.rmtree(STAGING, ignore_errors=True)
