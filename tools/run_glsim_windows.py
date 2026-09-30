"""
Run glsim on Windows, working around three failures that only appear there.

Adapted from the runner in the StrataSure repository, which found all three the
hard way. Each patch is a no-op if the thing it fixes is not present, so this is
safe to use on any platform, and safe to use after the upstream fixes land.

  1. `os.unlink` raises PermissionError with winerror 32 (the file is open in
     another process) when glsim removes a database or log. Windows will not let
     you unlink an open file, and the intent here is always cleanup.

  2. The v0.3 calldata decoder returns the method under an empty string key
     instead of "method", which silently makes every call look like it has no
     method name.

  3. glsim's eth_sendRawTransaction ignores the value carried in a GenLayer
     payload, so a contract that reads `gl.message.value` sees zero. The keeper
     reimbursement in this project depends on that value being right, so this
     patch is not cosmetic.

Usage:

    python tools/run_glsim_windows.py --port 4000 --validators 5

Then, in another shell:

    $env:GENLAYER_RPC = "http://127.0.0.1:4000/api"
    gltest tests/integration -v -s --contracts-dir contracts
"""

import os
import sys


def _patch_windows_unlink() -> bool:
    """winerror 32 means the file is open elsewhere. glsim only unlinks to clean up."""
    if os.name != "nt":
        return False

    original_unlink = os.unlink

    def safe_unlink(path):
        try:
            return original_unlink(path)
        except PermissionError as error:
            if getattr(error, "winerror", None) != 32:
                raise
            return None

    os.unlink = safe_unlink
    return True


def _patch_v3_calldata() -> bool:
    """A v0.3 decoder quirk: the method arrives under "" rather than "method"."""
    try:
        from genlayer_py.abi import calldata
    except Exception:
        return False

    original_decode = calldata.decode

    def decode(raw):
        value = original_decode(raw)
        if isinstance(value, dict) and "method" not in value and "" in value:
            value = dict(value)
            value["method"] = value.pop("")
        return value

    calldata.decode = decode
    return True


def _patch_transaction_value() -> bool:
    """
    glsim drops the value in a GenLayer payload, so payable calls see zero.

    This project reads `gl.message.value` in fund(), and pays a keeper out of the
    treasury each cycle, so a chain where value is lost would not exercise the
    path it is supposed to exercise.
    """
    try:
        import glsim.server as server
    except Exception:
        return False

    original_rpc = server.RPC_METHODS.get("eth_sendRawTransaction")
    if original_rpc is None:
        return False

    def send_raw_transaction(state, engine, params):
        raw_hex = server._positional(params, 0)
        eth_tx = server.decode_raw_transaction(raw_hex)
        gl_payload = server.decode_genlayer_payload(eth_tx["data"])
        user_value = gl_payload.get("user_value")
        if user_value is None:
            user_value = eth_tx["value"]
        previous_value = engine.vm.value
        engine.vm.value = int(user_value)
        try:
            return original_rpc(state, engine, params)
        finally:
            engine.vm.value = previous_value

    server.RPC_METHODS["eth_sendRawTransaction"] = send_raw_transaction
    return True


def main() -> int:
    applied = {
        "windows unlink": _patch_windows_unlink(),
        "v3 calldata": _patch_v3_calldata(),
        "transaction value": _patch_transaction_value(),
    }
    on = ", ".join(name for name, ok in applied.items() if ok) or "nothing (already fixed upstream)"
    print(f"glsim patches applied: {on}", file=sys.stderr)

    try:
        from glsim.__main__ import main as glsim_main
    except Exception as error:  # pragma: no cover - depends on the install
        print(f"glsim is not installed: {error}", file=sys.stderr)
        print("pip install glsim", file=sys.stderr)
        return 1

    glsim_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
