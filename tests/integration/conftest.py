"""Guard rail for the consensus tests.

These need a running GenLayer network. Running them under plain pytest against
nothing produces confusing RPC errors, so the session checks for a reachable
RPC endpoint first and skips with instructions instead.
"""

import json
import os
import urllib.error
import urllib.request

import pytest

DEFAULT_RPC = "http://127.0.0.1:4000/api"


def _rpc_url() -> str:
    return os.environ.get("GENLAYER_RPC", DEFAULT_RPC)


def _reachable(url: str, timeout: float = 2.0) -> bool:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []})
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return "result" in payload


@pytest.fixture(scope="session", autouse=True)
def require_genlayer_network():
    url = _rpc_url()
    if not _reachable(url):
        pytest.skip(
            f"No GenLayer node at {url}. Start one and point GENLAYER_RPC at it, e.g.\n"
            "  glsim --port 4000 --validators 5\n"
            "  genlayer up            # full GenVM via Studio, needs Docker\n"
            "Then run: gltest tests/integration -v -s --contracts-dir contracts"
        )
