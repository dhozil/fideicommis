"""Run the two server-only CI checks locally, on a machine with no bash.

Marker for marker, so the workflow is verified here rather than on its first push.
"""

import pathlib
import re
import sys

failures = []


def section(title):
    print(f"\n=== {title} ===")


section("both server-only modules still declare the marker")
for rel in ["web/src/lib/genlayer.ts", "web/src/lib/trust.ts", "web/src/lib/featured.ts"]:
    first = pathlib.Path(rel).read_text(encoding="utf-8").splitlines()[0]
    ok = first.strip() == 'import "server-only";'
    print(f"  {'ok  ' if ok else 'FAIL'} {rel}  first line: {first.strip()!r}")
    if not ok:
        failures.append(f"{rel} no longer imports server-only")

section("no client component reaches the chain reader")
IMPORTS = re.compile(r'@/lib/(trust|genlayer|featured)|from "\./(trust|genlayer|featured)"')
src = pathlib.Path("web/src")
for f in sorted(src.rglob("*")):
    if f.suffix not in {".ts", ".tsx"} or not f.is_file():
        continue
    text = f.read_text(encoding="utf-8")
    if not IMPORTS.search(text):
        continue
    first = text.splitlines()[0] if text.splitlines() else ""
    is_client = "use client" in first
    print(f"  {'FAIL' if is_client else 'ok  '} {f.as_posix()}")
    if is_client:
        failures.append(f"{f.as_posix()} is a client component reaching the reader")

if failures:
    print("\nFAILED:")
    for f in failures:
        print(f"  {f}")
    sys.exit(1)

print("\nok: the server-only guarantee is both declared and unreached")
