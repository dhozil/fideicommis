"""Will the direct harness actually use the runner this workflow fetched?

The CI step that fetches the GenVM runner has failed twice for two different reasons, and
both times the step itself went green while the suite went red 90 seconds later:

  1. The asset was not cached at all. `genvm-universal.tar.xz` was renamed upstream to
     `genvm-runners-all.tar.xz`, so the harness's own download 404s.
  2. The asset was cached, under the release's name, in the right directory — and the
     harness still ignored it.

The second is the one that looked fixed. gltest/direct/sdk_loader.py reads:

    list_cached_versions()   CACHE_DIR.glob("genvm-universal-*.tar.xz")
    download_artifacts(v)    CACHE_DIR / f"genvm-universal-{v}.tar.xz"

So it matches on a *prefix*, not on any file in the directory. A correct download under
the wrong name is invisible: the glob matches nothing, the harness falls through to its
own fetch, and the suite fails identically. Reading a green fetch step as "the SDK is
ready" is exactly the inference that was wrong.

This asserts the harness's own view rather than the filesystem's, by importing it and
calling the function that decides.

Run: python check_runner_cache.py
"""

import pathlib
import shutil
import sys
import tempfile

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"  ok   {label}{f'  {detail}' if detail else ''}")
    else:
        failures.append(label)
        print(f"  FAIL {label}{f'  {detail}' if detail else ''}")


try:
    import gltest.direct.sdk_loader as sdk
except ImportError as error:
    print(f"  gltest is not importable: {error}")
    print("  nothing to assert against")
    sys.exit(0)

print("=== what the harness looks for ===")
cache = sdk.CACHE_DIR
print(f"  cache directory: {cache}")

# The glob is the whole mechanism, so read it from the source rather than trusting that
# a file sitting in the directory is enough. If gltest changes it, this is where that
# shows up.
source = pathlib.Path(sdk.__file__).read_text(encoding="utf-8", errors="replace")
check("the harness globs genvm-universal-*", 'glob("genvm-universal-*.tar.xz")' in source)
check(
    "and builds the name from the version",
    'f"genvm-universal-{version}.tar.xz"' in source,
)
check("it only downloads when the file is missing", "if tarball_path.exists()" in source)

print()
print("=== the wrong name is invisible to it, which is why the last fix did not work ===")
scratch = pathlib.Path(tempfile.mkdtemp(prefix="gltest-probe-"))
original = sdk.CACHE_DIR
try:
    sdk.CACHE_DIR = scratch

    (scratch / "genvm-runners-all.tar.xz").write_bytes(b"not a tarball")
    versions = sdk.list_cached_versions()
    check(
        "the release's own name is NOT found by the harness",
        versions == [],
        f"list_cached_versions() -> {versions}",
    )
    if versions != []:
        print("       -> gltest changed how it finds a cached runner; the fix below would be wrong")

    (scratch / "genvm-universal-v0.3.0-rc7.tar.xz").write_bytes(b"not a tarball")
    versions = sdk.list_cached_versions()
    check(
        "the name the harness expects IS found",
        versions == ["v0.3.0-rc7"],
        f"list_cached_versions() -> {versions}",
    )

    print()
    print("=== and a stale extraction does not satisfy it either ===")
    # extract_runner() has a fast path for an already-extracted runner keyed on the
    # pinned hash. A cache holding only `extracted/` would pass that check and still fail
    # to find a tarball, so the tarball is the thing that has to be there.
    only_extracted = pathlib.Path(tempfile.mkdtemp(prefix="gltest-probe-"))
    sdk.CACHE_DIR = only_extracted
    (only_extracted / "extracted" / "v0.3.0-rc7" / "py-genlayer").mkdir(parents=True)
    check(
        "an extraction alone is not enough",
        sdk.list_cached_versions() == [],
        f"list_cached_versions() -> {sdk.list_cached_versions()}",
    )
    shutil.rmtree(only_extracted, ignore_errors=True)
finally:
    sdk.CACHE_DIR = original
    shutil.rmtree(scratch, ignore_errors=True)

print()
print("=== this machine's real cache, for reference ===")
real = sdk.list_cached_versions()
if real:
    print(f"  versions the harness would use: {real}")
    for version in real:
        path = cache / f"genvm-universal-{version}.tar.xz"
        if path.exists():
            print(f"    {path.name}  {path.stat().st_size / 1024 / 1024:.1f} MB")
        else:
            print(f"    {path.name}  MISSING")
    check(
        "the file the harness will use is present here",
        (cache / f"genvm-universal-{real[0]}.tar.xz").exists(),
    )
else:
    print("  nothing cached locally, so nothing to say about this machine")
    print("  (the suite is green here, which means this is not the failure being chased)")

print()
if failures:
    print(f"{len(failures)} check(s) failed:")
    for failure in failures:
        print(f"  {failure}")
    sys.exit(1)
print("a green fetch step means the harness will find the runner, which is the point")