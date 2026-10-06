"""Do the two documents agree with each other, and with the code?

A README and a FINDINGS file that drift apart are worse than one document, because
the reader has no way to tell which one to believe. This checks the claims that are
specific enough to be wrong: the test counts, the method and field counts, the pinned
runner, the hard limits, and every internal link.
"""

import pathlib
import re
import subprocess
import sys

README = pathlib.Path("README.md").read_text(encoding="utf-8")
FINDINGS = pathlib.Path("FINDINGS.md").read_text(encoding="utf-8")
CONTRACT = pathlib.Path("contracts/fideicommis.py").read_text(encoding="utf-8")
ROOT = pathlib.Path(".")

failures = []
notes = []


def claim(label, expected, haystacks=(README,), docs="README"):
    """The string must appear in every document that is checked."""
    missing = [name for name, text in zip(docs, haystacks) if expected not in text]
    if missing:
        failures.append(f"{label}: '{expected}' not in {', '.join(missing)}")
    else:
        notes.append(f"ok   {label}: {expected}")


def count_declaration_methods(text):
    """Public methods the linter would count: one @gl.public decorator each."""
    return len(re.findall(r"@gl\.public\.(view|write)", text))


def count_storage_fields(text):
    body = text.split("class Fideicommis", 1)[1]
    return len(re.findall(r"^    (\w+):\s*\S", body, re.M))


def count_direct_tests():
    """
    Direct-mode test functions, counted rather than remembered.

    This was the literal `117` while the suite had grown to 121 cases, and the check passed
    the whole time — it was asserting that both documents agreed with each other about a
    number neither of them re-derived. A figure pinned in prose is a figure that goes stale
    quietly, which is the same failure as the fixed storage layout having once been described
    only in a comment.

    Functions, not cases: several tests are parameterised over the contract's storage fields
    and sources, so pytest collects more cases than there are functions. The case count is
    not derivable without running pytest, so it is not pinned — pinning it would reintroduce
    exactly the drift this replaces.
    """
    total = 0
    for path in sorted(ROOT.glob("tests/*.py")):
        total += len(re.findall(r"^def test_", path.read_text(encoding="utf-8"), re.M))
    return total


print("=== figures that must agree across the documents ===")

methods = count_declaration_methods(CONTRACT)
views = len(re.findall(r"@gl\.public\.view", CONTRACT))
writes = len(re.findall(r"@gl\.public\.write", CONTRACT))
fields = count_storage_fields(CONTRACT)
direct_tests = count_direct_tests()

print(f"  the contract actually has: {methods} methods ({views} view, {writes} write), "
      f"{fields} storage fields")
print(f"  the direct-mode suite actually has: {direct_tests} test functions")
notes.append(f"ok   contract: {methods} methods, {fields} fields")

claim("method count", f"{methods} methods", (README,))
claim("storage field count", f"{fields} names and types", (README,))
claim("direct-mode test functions", f"{direct_tests} test functions", (README, FINDINGS), "both documents")
claim("consensus test count", "eight consensus tests", (README,), "README")
claim("pinned runner", "py-genlayer:1jb45aa8yn", (README,), "README")
claim("quorum floor", "25%", (README,), "README")
claim("ceiling cap", "50%", (README,), "README")

# The hard limits must match the contract's own constants, not just the prose.
floor = re.search(r"MIN_QUORUM_BPS\s*=\s*(\d+)", CONTRACT)
ceiling = re.search(r"MAX_SPEND_CEILING_BPS\s*=\s*(\d+)", CONTRACT)
if floor and ceiling:
    floor_pct = int(floor.group(1)) / 100
    ceiling_pct = int(ceiling.group(1)) / 100
    if f"{floor_pct:.0f}%" not in README:
        failures.append(f"README says no {floor_pct:.0f}% floor, the contract sets MIN_QUORUM_BPS={floor.group(1)}")
    if f"{ceiling_pct:.0f}%" not in README:
        failures.append(f"README says no {ceiling_pct:.0f}% ceiling, the contract sets MAX_SPEND_CEILING_BPS={ceiling.group(1)}")
    notes.append(f"ok   hard limits match the contract: {floor_pct:.0f}% / {ceiling_pct:.0f}%")
else:
    failures.append("could not read MIN_QUORUM_BPS or MAX_SPEND_CEILING_BPS from the contract")

print()
print("=== every internal link in both documents resolves ===")


def anchors_of(markdown):
    found = set()
    for line in markdown.splitlines():
        if line.startswith("#"):
            title = re.sub(r"^#+\s*", "", line).strip()
            slug = title.lower()
            slug = re.sub(r"[^\w\s-]", "", slug)
            slug = re.sub(r"\s+", "-", slug)
            found.add(slug)
    return found


def links_of(markdown):
    return re.findall(r"\]\(#([^)]+)\)", markdown)


for name, text in (("README.md", README), ("FINDINGS.md", FINDINGS)):
    available = anchors_of(text)
    broken = sorted({target for target in links_of(text) if target not in available})
    if broken:
        failures.append(f"{name}: broken anchors {broken}")
    else:
        notes.append(f"ok   {name}: every internal anchor resolves")

print()
print("=== FINDINGS is linked from the README ===")
if "FINDINGS.md" not in README:
    failures.append("README does not link FINDINGS.md, so the evidence is unreachable")
else:
    notes.append("ok   README links FINDINGS.md")

print()
for note in notes:
    print(f"  {note}")

if failures:
    print("\nFAILED:")
    for item in failures:
        print("  ", item)
    sys.exit(1)

print("\nthe two documents agree.")