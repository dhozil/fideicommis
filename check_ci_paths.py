"""Do the paths CI depends on still exist?

The reader was renamed from web/ to frontend/, and three workflow steps still named
the old directory. A step whose working-directory is gone fails, so those steps had
been silently not running: the typecheck, the build, and the key-material guard. None
of them would have said anything about that. They would simply have stopped.

This checks every working-directory in every workflow against the filesystem, because
the failure mode is invisible in the workflow file itself.
"""

import pathlib
import re
import sys

failures = []
checked = 0

for workflow in sorted(pathlib.Path(".github/workflows").glob("*.y*ml")):
    text = workflow.read_text(encoding="utf-8")
    for match in re.finditer(r"working-directory:\s*['\"]?([^\s'\"]+)", text):
        directory = match.group(1)
        line = text[: match.start()].count("\n") + 1
        checked += 1
        exists = pathlib.Path(directory).is_dir()
        if exists:
            print(f"  ok    {workflow.name}:{line}  {directory}")
        else:
            print(f"  FAIL  {workflow.name}:{line}  {directory} does not exist")
            failures.append(f"{workflow.name}:{line} -> {directory}")

# The npm scripts CI invokes by name.
import json

pkg = json.loads(pathlib.Path("package.json").read_text(encoding="utf-8"))
for script, command in pkg.get("scripts", {}).items():
    for workspace in re.findall(r"--workspace\s+(\S+)", command):
        checked += 1
        if pathlib.Path(workspace).is_dir():
            print(f"  ok    package.json script {script}  {workspace}")
        else:
            print(f"  FAIL  package.json script {script}  {workspace} does not exist")
            failures.append(f"script {script} -> {workspace}")

# Files the docs tell a reader to run.
for doc in ["README.md", "CONTRIBUTING.md", "AGENTS.md"]:
    text = pathlib.Path(doc).read_text(encoding="utf-8")
    # Prose only. A path inside a fenced code block or a comment is documentation of
    # the path, not a dependency on it, and this file's own comment about the old
    # `web/` name would otherwise be reported as a broken reference.
    for mentioned in sorted(
        set(
            re.findall(
                r"`((?:web|frontend)/[A-Za-z0-9_./-]+)`", text
            )
        )
    ):
        top = mentioned.split("/")[0]
        checked += 1
        exists = pathlib.Path(top).is_dir()
        mark = "ok   " if exists else "FAIL "
        # Backticked in the docs means "this path"; unbackticked in a workflow means
        # the step runs there. Only the former is a dependency worth asserting.
        if "{" in mentioned:
            continue
        print(f"  {mark} {doc} mentions {mentioned}")
        if not exists:
            failures.append(f"{doc} mentions {mentioned}")

print()
if failures:
    print(f"{len(failures)} path(s) CI or the docs depend on do not exist:")
    for failure in failures:
        print(f"  {failure}")
    sys.exit(1)
print(f"all {checked} paths CI and the docs name exist")
