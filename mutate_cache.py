"""Prove the cache's new negative caching cannot hide a real failure.

`cached()` remembering a rejection is the one change in this session that could make the
reader lie. A cache that replays a stale "could not be found" after the transaction has
settled would report `no record` for something real — which is precisely the failure this
project exists to avoid, arrived at by the opposite route.

So the three ways that could go wrong are each broken on purpose, and each must produce a
different answer than the one the cache would replay:

  1. an unnamed failure (a rate limit) must never be remembered, so it throws every time
  2. a remembered absence must be re-thrown, never returned as a value
  3. a remembered absence must be dropped once a real read succeeds

Usage: python mutate_cache.py
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

SRC = pathlib.Path("frontend/src/lib/cache.ts")

MUTATIONS = [
    (
        "remember every failure, so a rate limit is replayed for a minute",
        ["if (options.cacheRejection?.(error)) {"],
        ["if (true || options.cacheRejection?.(error)) {"],
    ),
    (
        "return a remembered absence as a value instead of re-throwing it",
        ["if (hit.failure) return Promise.reject(hit.failure);"],
        ["if (hit.failure) return Promise.resolve(null as T);"],
    ),
    (
        # This replaces two earlier attempts at the same mutation, both of which survived
        # — and both were non-tests rather than weak tests.
        #
        # Weakening only `prune` is invisible: every read re-checks the TTL at the hit
        # site, so pruning early or late changes no result. Weakening only the hit check is
        # equally invisible, because `prune` has already deleted the entry by then. TTL
        # expiry is enforced redundantly, so it takes breaking both to observe it at all,
        # and a mutation that cannot change any outcome is not evidence of anything.
        #
        # Worth recording rather than quietly replacing, because "the test missed it" and
        # "the mutation was unobservable" look identical from the outside and have
        # opposite causes.
        "let a remembered absence outlive its TTL",
        [
            "if (now - entry.at > (entry.ttlMs ?? TTL_MS)) cache.delete(key);",
            "if (hit && now - hit.at <= (hit.ttlMs ?? TTL_MS)) {",
        ],
        [
            "if (now - entry.at > TTL_MS) cache.delete(key);",
            "if (hit && now - hit.at <= TTL_MS) {",
        ],
    ),
]

original = SRC.read_text(encoding="utf-8")
backup = tempfile.mktemp(suffix=".ts")
shutil.copyfile(SRC, backup)

npx = shutil.which("npx.cmd") or shutil.which("npx")
if not npx:
    sys.exit("npx not found on PATH")

survived = []
try:
    for label, old, new in MUTATIONS:
        if isinstance(old, str):
            old, new = [old], [new]
        broken = original
        for anchor, replacement in zip(old, new):
            if anchor not in broken:
                print(f"  SKIP {label}\n       (anchor not found, so nothing was broken)")
                survived.append(label)
                broken = None
                break
            broken = broken.replace(anchor, replacement, 1)
        if broken is None:
            continue
        SRC.write_text(broken, encoding="utf-8", newline="\n")
        proc = subprocess.run(
            [npx, "--yes", "tsx@4", "tests/check_cache.mts"],
            capture_output=True,
            text=True,
        )
        caught = proc.returncode != 0
        print(f"  {'caught  ' if caught else 'SURVIVED'} {label}")
        if caught:
            detail = next(
                (
                    line.strip()
                    for line in proc.stdout.splitlines()
                    if line.strip().startswith("FAIL")
                ),
                "",
            )
            print(f"           {detail}")
        else:
            survived.append(label)
finally:
    shutil.copyfile(backup, SRC)
    pathlib.Path(backup).unlink(missing_ok=True)

print()
print(f"  source restored byte-for-byte: {SRC.read_text(encoding='utf-8') == original}")
if survived:
    print(f"  {len(survived)} mutation(s) went uncaught — the cache could hide a real failure")
    sys.exit(1)
print(f"  all {len(MUTATIONS)} mutations caught")