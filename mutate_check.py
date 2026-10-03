"""
Asserting an expectation is only worth something if a wrong implementation is caught.

`tests/check_equivalence.ts` used to carry an `expect` string on every case and never
compare against it — the loop called the extractor, printed the result, and passed as
long as nothing threw. A test named as though it verified the report, verifying only that
the parser does not crash.

The expectations are asserted now. This file proves they can fail, by breaking the parser
four ways on purpose and requiring a different answer each time, then restoring the source
and checking it came back byte-for-byte.

Run: python mutate_check.py
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

SRC = pathlib.Path("frontend/src/lib/equivalence.ts")

MUTATIONS = [
    (
        "undo the leaderError split, so a rollback's payload becomes an output again",
        "    if (returned) leaderOutput = payloadText;",
        "    leaderOutput = payloadText;",
    ),
    (
        "report a split committee as unanimous",
        'agreed: perValidator.filter((v) => v.vote === "agree").length,',
        "agreed: perValidator.length,",
    ),
    (
        "read a validator's vote from the wrong key, so agreement is always zero",
        'agreed: perValidator.filter((v) => v.vote === "agree").length,',
        'agreed: perValidator.filter((v) => v.vote === "AGREE").length,',
    ),
    (
        "invent an output when the leader returned none",
        "  let leaderError: string | null = null;",
        '  let leaderError: string | null = "ok";',
    ),
]

original = SRC.read_text(encoding="utf-8")
backup = tempfile.mktemp(suffix=".ts")
shutil.copyfile(SRC, backup)

# npx is a shell script on Windows, so subprocess needs the .cmd shim or it fails with
# WinError 2 before the test runs — which looks like a missing test.
npx = shutil.which("npx.cmd") or shutil.which("npx")
if not npx:
    sys.exit("npx not found on PATH")

survived = []
try:
    for label, old, new in MUTATIONS:
        if old not in original:
            print(f"  SKIP {label}\n       (anchor not found, so the mutation was not applied)")
            survived.append(label)
            continue
        SRC.write_text(original.replace(old, new, 1), encoding="utf-8", newline="\n")
        proc = subprocess.run(
            [npx, "--yes", "tsx@4", "tests/check_equivalence.ts"],
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
                    if line.strip().startswith(("output", "error", "agreed", "validators"))
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
    print(f"  {len(survived)} mutation(s) were not caught")
    sys.exit(1)
print(f"  all {len(MUTATIONS)} mutations caught")