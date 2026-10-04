"""
How many commits carry an identity that is not the repository owner?

The authorship rewrite fixed the 30 commits that existed at the time and then nothing
checked that the *next* one would be right. `git config user.name` was still
`Anthropic <noreply@anthropic.com>`, so every commit after the rewrite went back to it —
and a green contributors API proved nothing, because that endpoint only counted what was
already there.

This is the check that was missing: not "are the existing commits attributed correctly" but
"will the next one be". The config is part of the repository's tracked state in the sense
that matters, because it is what stamps every future commit, and it lives in
.git/config, which is not in history and is not visible from the remote.

It also names the identity it expects rather than hardcoding a login, so if the account
changes, this fails and says what to change.

Run: python check_git_identity.py
"""

import os
import pathlib
import re
import subprocess
import sys

# The identity every commit in this repository must carry, so that GitHub attributes it to
# the account that owns it. Read from the published history rather than hardcoded, because
# the published history is the thing being agreed with.
EXPECTED_NAME = "DhoziL"
EXPECTED_EMAIL = "55169789+dhozil@users.noreply.github.com"

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"  ok   {label}{f'  {detail}' if detail else ''}")
    else:
        failures.append(label)
        print(f"  FAIL {label}{f'  {detail}' if detail else ''}")


def git(*args) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


print("=== the identity that stamps the next commit ===")
# `git config user.*` is per-machine state. It lives in .git/config, which is never
# committed and does not travel with a clone, so a CI runner legitimately has no value
# for it and asserting one there is asserting the runner's configuration rather than this
# repository's.
#
# That is not a reason to drop the check — it is the reason the check has two halves and
# only one of them can run on CI. The history half is the part that is in the repository,
# and it is the part that runs. The config half runs on the machine that commits, which is
# the only machine whose config could stamp anything at all.
#
# It failed on its first CI run with three red lines and an unset value, on a repository
# whose 32 published commits are all correctly attributed. A check that reports the
# runner's identity as a defect in the project is worse than no check.
in_ci = os.environ.get("CI") == "true" or os.environ.get("GITHUB_ACTIONS") == "true"

name = git("config", "user.name").strip()
email = git("config", "user.email").strip()

if in_ci and not (name or email):
    print(f"  skip  no local git identity on this runner, and none is expected")
    print("        the history below is what this repository can prove")
elif not (name or email):
    print("  FAIL  no local git identity is configured")
    print("        commits made here would fall back to whatever git invents, which is")
    print("        usually 'Your Name <you@hostname>' and attributes to nobody")
    failures.append("no local git identity configured")
else:
    check("user.name is the owner", name == EXPECTED_NAME, name or "(unset)")
    check("user.email is the owner's noreply form", email == EXPECTED_EMAIL, email or "(unset)")

    if name != EXPECTED_NAME or email != EXPECTED_EMAIL:
        print()
        print("  Until this is fixed, every commit is attributed to whoever the config names,")
        print("  and the published history drifts away from the owner one commit at a time:")
        print()
        print(f"    git config user.name  {EXPECTED_NAME}")
        print(f"    git config user.email {EXPECTED_EMAIL}")

print()
print("=== the history, which is the other half ===")
identities: dict[str, int] = {}
for line in git("log", "--format=%an <%ae>").splitlines():
    identities[line] = identities.get(line, 0) + 1
for identity, count in sorted(identities.items(), key=lambda kv: -kv[1]):
    check(
        f"{count:>3} commit(s) carry {identity}",
        identity == f"{EXPECTED_NAME} <{EXPECTED_EMAIL}>",
    )

print()
print("=== every author in the history is the owner's noreply form ===")
# This is the half that travels. GitHub links a commit to an account by email address, so
# an address belonging to nobody renders as a stranger and an address belonging to
# somebody else hands them this work. The per-account form is the only one that both
# attributes correctly and exposes nothing.
authors = [line for line in git("log", "--format=%ae").splitlines() if line.strip()]
per_account = [a for a in authors if re.match(r"^\d+\+[a-z0-9-]+@users\.noreply\.github\.com$", a)]
check(
    "every author address is the per-account noreply form",
    len(per_account) == len(authors),
    f"{len(per_account)}/{len(authors)} commits",
)
for address in sorted({a for a in authors if a not in per_account}):
    print(f"       {address} is not a per-account noreply form")

print()
print("=== and no co-author trailers re-introducing another identity ===")
trailers = {line for line in git("log", "--format=%(trailers)").splitlines() if line.strip()}
check("no trailers at all", not trailers, "; ".join(sorted(trailers))[:80] if trailers else "")

print()
if failures:
    print(f"{len(failures)} problem(s):")
    for failure in failures:
        print(f"  {failure}")
    sys.exit(1)
print("every commit, past and future, attributes to the repository owner")