"""
Is this repository safe to publish?

This is about to be pushed to a public GitHub URL, so the question is not whether the
code is good — it is whether anything private is in it. Three things can carry a secret
into a public repository and only the first is obvious:

  1. a file that was never ignored, currently tracked
  2. a file that is ignored now but was committed earlier, so it is in the history
  3. a secret written into a file that is meant to be public — a default, a fixture, a
     test, a comment

The third is the one a .gitignore cannot help with. This project already had two
instances of the project's own rule being broken by a test that asserted nothing, so it
is worth checking rather than assuming.

Nothing here is destructive. It reads.
"""

import os
import pathlib
import re
import subprocess
import sys

problems = []
notes = []

# --- 1. what is tracked that should not be ---------------------------------------------

print("=== tracked files whose names suggest something private ===")
tracked = subprocess.run(
    ["git", "ls-files"], capture_output=True, text=True, check=True
).stdout.splitlines()

NAME_PATTERN = re.compile(
    r"(^|/)(\.env|.*\.key|.*\.pem|.*\.p12|.*\.pfx|id_rsa|id_ed25519|.*secret.*|.*credential.*|"
    r"keystore.*|.*\.keystore)$",
    re.I,
)
suspect = [path for path in tracked if NAME_PATTERN.search(path)]
if suspect:
    for path in suspect:
        print(f"  FAIL {path}")
        problems.append(f"tracked private-looking file: {path}")
else:
    print("  none")

print()
print("=== is anything ignored that ought to be, and is it actually ignored? ===")
# Files that must never be public, whether or not they exist right now.
MUST_IGNORE = [
    "frontend/.env.local",
    "frontend/.env.production",
    ".env",
    ".env.local",
    "scripts/orgkeeper.key",
]
for path in MUST_IGNORE:
    exists = pathlib.Path(path).exists()
    ignored = (
        subprocess.run(
            ["git", "check-ignore", "-q", path], capture_output=True
        ).returncode
        == 0
    )
    if exists and not ignored:
        print(f"  FAIL {path} exists and is NOT ignored")
        problems.append(f"{path} exists and is not ignored")
    elif exists and ignored:
        print(f"  ok   {path} exists and is ignored")
    else:
        # Not present, and the rule exists: still worth stating, because the day it
        # appears it must be ignored, and that is a property of .gitignore not of today.
        still_ignored = (
            subprocess.run(
                ["git", "check-ignore", "-q", path], capture_output=True
            ).returncode
            == 0
        )
        if still_ignored:
            print(f"  ok   {path} absent, and the rule covers it")
        else:
            print(f"  FAIL {path} absent, and nothing would stop it being committed")
            problems.append(f"{path} has no ignore rule")

print()
print("=== a key file present on disk but absent from history ===")
# The one key this project actually uses, named in the project's own instructions.
for key in ["scripts/orgkeeper.key"]:
    on_disk = pathlib.Path(key).exists()
    in_history = (
        subprocess.run(
            ["git", "log", "--all", "--oneline", "--", key],
            capture_output=True,
            text=True,
        ).stdout.strip()
        != ""
    )
    if on_disk and not in_history:
        print(f"  ok   {key} exists on disk and has never been committed")
    elif in_history:
        print(f"  FAIL {key} appears in history")
        problems.append(f"{key} is in git history")
    elif on_disk:
        print(f"  FAIL {key} is on disk AND in history")
        problems.append(f"{key} is on disk and in history")

print()
print("=== 32-byte hex literals in tracked files, by category ===")
# A hash of that shape is legitimate in three places and dangerous in a fourth:
#   - explorer link tests, which need a syntactically valid hash
#   - the key-material CI guard's own pattern
#   - a documented fixture, if it says so
#   - a wallet or deploy file, which is where a private key would be
DANGEROUS = re.compile(
    r"(wallet|deploy|key|seed|mnemonic|secret|credential|private)", re.I
)
for path in tracked:
    full = pathlib.Path(path)
    if not full.is_file():
        continue
    try:
        text = full.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    hits = re.findall(r"0x[0-9a-fA-F]{64}", text)
    if not hits:
        continue
    if DANGEROUS.search(path):
        print(f"  FAIL {path}  ({len(hits)} literal(s))")
        for hit in sorted(set(hits))[:4]:
            print(f"       {hit}")
        problems.append(f"64-hex literal in {path}")
    else:
        print(f"  ok   {path}  ({len(hits)} literal(s), not a secret-shaped path)")

print()
print("=== hex that looks like a raw private key, anywhere tracked ===")
# Not 0x-prefixed: a bare 64-hex is what a key looks like in a .env or a note.
found_any = False
for path in tracked:
    full = pathlib.Path(path)
    if not full.is_file() or full.suffix in {".png", ".jpg", ".woff", ".woff2"}:
        continue
    try:
        text = full.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for lineno, line in enumerate(text.splitlines(), 1):
        if re.search(r"\b[0-9a-fA-F]{64}\b", line):
            # Fixtures and hashes in tests are expected; a wallet or env file is not.
            if DANGEROUS.search(path) or re.search(
                r"(PRIVATE_KEY|private_key|secret|mnemonic)", line
            ):
                print(f"  FAIL {path}:{lineno}")
                print(f"       {line.strip()[:110]}")
                problems.append(f"raw hex on a secret-shaped line at {path}:{lineno}")
                found_any = True
if not found_any:
    print("  none on any secret-shaped line")

print()
print("=== the deploy state, which records a key path ===")
for path in ["deploy/state.json", "deploy/.deploystate"]:
    p = pathlib.Path(path)
    if p.exists():
        tracked_now = path in tracked
        print(f"  {path} exists, tracked: {tracked_now}")
        if tracked_now:
            body = p.read_text(encoding="utf-8")
            # It may legitimately name a key file. What must not be in it is key material.
            has_material = re.search(r"[0-9a-fA-F]{64}", body)
            print(f"  {'FAIL' if has_material else 'ok  '} contains 64-hex material: {bool(has_material)}")
            if has_material:
                problems.append(f"{path} contains 64-hex material")

print()
print("=== summary ===")
if problems:
    print(f"  {len(problems)} problem(s); do not push yet:")
    for problem in problems:
        print(f"    {problem}")
    sys.exit(1)
print("  nothing private found in the working tree or in this pass over the history")
for note in notes:
    print(f"  note: {note}")