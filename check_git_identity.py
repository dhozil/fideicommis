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
name = git("config", "user.name").strip()
email = git("config", "user.email").strip()
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
print("=== a name that is not the account would still render as a stranger ===")
# GitHub links a commit to an account by email. A plausible-looking personal address that
# belongs to nobody is harmless; one that belongs to somebody else attributes this work to
# them, which is worse than attributing it to a bot.
noreply = re.match(r"^\d+\+[a-z0-9-]+@users\.noreply\.github\.com$", email)
check("the email is the per-account noreply form", bool(noreply), email)
if email and "@users.noreply.github.com" not in email:
    print("       a private address would be exposed in every commit; the noreply form is not")

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