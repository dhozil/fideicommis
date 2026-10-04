"""
Does this repository build the way Vercel will build it?

A deployment that only works on the machine that made it is the usual way a Vercel setup
fails, and it fails late — after the push, after the environment variables are typed in,
and often after a domain is pointed at it. Everything here is therefore checked against
the file Vercel reads rather than against what works locally.

The four things that decide a Vercel build, all read from `vercel.json` and checked to
actually exist:

  - `installCommand` needs a lockfile at the repository root, not one level down
  - `buildCommand` must be a script that the root `package.json` really defines
  - `outputDirectory` must be where the build actually writes
  - `framework` must match the dependency that is installed

Plus the case that is easy to miss: **a build with no environment variables set at all.**
Every variable the reader reads already has a default in the source, so a fresh Vercel
project with nothing configured should still build. If it does not, the deployment
fails before anyone can add the variables.

Run: python check_deploy.py
"""

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

failures = []
notes = []


def check(label: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"  ok   {label}{f'  {detail}' if detail else ''}")
    else:
        failures.append(f"{label}{f'  {detail}' if detail else ''}")
        print(f"  FAIL {label}{f'  {detail}' if detail else ''}")


print("=== vercel.json is readable JSON ===")
vercel_path = pathlib.Path("vercel.json")
if not vercel_path.exists():
    print("  FAIL no vercel.json at the repository root")
    sys.exit(1)
try:
    vercel = json.loads(vercel_path.read_text(encoding="utf-8"))
    print("  ok   parses")
except json.JSONDecodeError as err:
    print(f"  FAIL does not parse: {err}")
    sys.exit(1)

root_pkg = json.loads(pathlib.Path("package.json").read_text(encoding="utf-8"))
fe_pkg = json.loads(pathlib.Path("frontend/package.json").read_text(encoding="utf-8"))
root_scripts = root_pkg.get("scripts", {})

print()
print("=== installCommand ===")
install = vercel.get("installCommand", "npm ci")
check("a single lockfile at the root", pathlib.Path("package-lock.json").exists())
nested = list(pathlib.Path("frontend").glob("package-lock.json"))
check("no competing lockfile in frontend/", not nested, f"{len(nested)} found")
# npm ci is what makes the build reproducible; npm install would resolve fresh versions
# on the platform and is the reason a build that passed locally fails there.
check("installs reproducibly", "npm ci" in install, install)

print()
print("=== buildCommand is a script that exists ===")
build = vercel.get("buildCommand", "")
# Strip the leading `npm run ` if present, since that is the common form.
m = re.match(r"^(?:npm run |npm run-script |yarn |pnpm )(.+)$", build.strip())
script_name = m.group(1).strip() if m else None
if script_name is None:
    check("buildCommand names a script", False, build)
else:
    # A workspace flag is not part of the script name; strip it before looking it up.
    lookup = re.sub(r"\s+--workspace\s+\S+", "", script_name).strip()
    check(
        f"root package.json defines '{lookup}'",
        lookup in root_scripts,
        root_scripts.get(lookup, "MISSING"),
    )
    # And the workspace it targets must exist, or npm run resolves nothing.
    for workspace in re.findall(r"--workspace\s+(\S+)", build):
        check(f"workspace '{workspace}' exists", pathlib.Path(workspace).is_dir())

print()
print("=== outputDirectory is where the build writes ===")
out = vercel.get("outputDirectory", ".next")
check(
    "frontend/.next is the Next.js build directory",
    out.rstrip("/").endswith("frontend/.next"),
    out,
)
check(
    "the build produced it",
    pathlib.Path(out, "BUILD_ID").exists(),
    "BUILD_ID present" if pathlib.Path(out, "BUILD_ID").exists() else "no BUILD_ID — run the build first",
)

# The one thing this file cannot check, because it lives in the Vercel UI rather than in
# the repository: the project's Root Directory setting.
#
# `outputDirectory` is resolved *relative to* the Root Directory, not to the repository
# root. So the two settings have to agree, and the failure when they do not is a doubled
# path rather than a missing one:
#
#     Root Directory = frontend/   +   outputDirectory = frontend/.next
#     resolves to    frontend/frontend/.next      ← does not exist, and cannot
#
# This repository's vercel.json is written for Root Directory = the repository root, which
# is also what VERCEL.md instructs and what CI can verify. A deployment that sets the Root
# Directory to `frontend/` gets this exact error, and nothing in the repository can prevent
# it — Vercel does not read VERCEL.md.
#
# So it is stated as loudly as this file can state it, and the two shapes are printed so a
# reader who has this error can match it against what they set.
root = pathlib.Path(out)
doubled = root.parent / out
check(
    "the path is not doubled",
    not doubled.exists(),
    f"{out} — setting Root Directory to frontend/ makes this resolve to frontend/{out}",
)
print()
print("  Vercel resolves outputDirectory relative to the Root Directory, not the repo root:")
print("    Root Directory = (empty)    ->  " + out + "            correct")
print("    Root Directory = frontend/  ->  frontend/" + out + "  does not exist")
print("  If the build fails with a path ending in frontend/frontend/.next, the Root")
print("  Directory is set to frontend/ in the Vercel UI and has to be cleared.")

print()
print("=== framework matches the dependency ===")
check(
    "framework is nextjs",
    vercel.get("framework") == "nextjs",
    str(vercel.get("framework")),
)
check("next is a dependency of frontend/", "next" in fe_pkg.get("dependencies", {}))

print()
print("=== every variable the reader reads has a default ===")
# A variable with no default is a build failure on a fresh project, because Vercel has
# nothing to put there yet. This is the single most common way this setup fails.
ENV_WITH_DEFAULTS = {
    "NEXT_PUBLIC_FEATURED_TRUST": "registry.ts",
    "NEXT_PUBLIC_GENLAYER_RPC_URL": "wallet.ts",
    "NEXT_PUBLIC_GENLAYER_CHAIN_NAME": "wallet.ts",
    "NEXT_PUBLIC_GENLAYER_SYMBOL": "wallet.ts",
}
declared_example = pathlib.Path(".env.example").read_text(encoding="utf-8") if pathlib.Path(".env.example").exists() else ""

used: dict[str, str] = {}
for path in list(pathlib.Path("frontend/src").rglob("*.ts")) + list(pathlib.Path("frontend/src").rglob("*.tsx")):
    # Comments are stripped first. `wallet.ts` documents its own history with the old
    # expression quoted in a comment, and searching the raw text found a variable read
    # that had been deleted — which is the same mistake the explorer check made earlier:
    # searching a file for a string it is describing rather than for code.
    lines = [
        line
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
        if not line.strip().startswith(("//", "*", "/*"))
    ]
    text = "\n".join(lines)
    for name in re.findall(r"process\.env\.(NEXT_PUBLIC_[A-Z_]+)", text):
        has_default = re.search(rf"process\.env\.{name}\s*\?\?", text) is not None
        used.setdefault(name, "default" if has_default else "REQUIRED")

for name, source in sorted(used.items()):
    check(f"{name} has a source default", source == "default", source)

print()
print("=== nothing in the reader wants a private key ===")
for path in list(pathlib.Path("frontend/src").rglob("*.ts")) + list(pathlib.Path("frontend/src").rglob("*.tsx")):
    text = path.read_text(encoding="utf-8", errors="replace")
    for name in re.findall(r"process\.env\.([A-Z_]*(?:PRIVATE|KEY|SECRET|MNEMONIC)[A-Z_]*)", text):
        check(f"{path.name} does not read {name}", False, "a key must never reach the reader")
if not any(
    re.search(r"process\.env\.[A-Z_]*(?:PRIVATE|KEY|SECRET|MNEMONIC)", p.read_text(encoding="utf-8", errors="replace"))
    for p in list(pathlib.Path("frontend/src").rglob("*.ts")) + list(pathlib.Path("frontend/src").rglob("*.tsx"))
):
    check("the reader reads no key material", True)

print()
print("=== .env.example documents every variable, and no secret ===")
for name in sorted(used):
    check(f".env.example mentions {name}", name in declared_example)

# And the reverse: a variable documented that nothing reads is a promise nobody keeps.
for name in sorted(set(re.findall(r"^(NEXT_PUBLIC_[A-Z_]+)=", declared_example, re.M))):
    check(f".env.example documents only what is read ({name})", name in used, "no source reads this")
check(
    ".env.example holds no secret",
    not re.search(r"[0-9a-fA-F]{64}", declared_example),
    "no 64-hex literal",
)

print()
print("=== .gitignore keeps the files that would carry a secret ===")
for path in [".env.local", ".env.production", "frontend/.env.local", "frontend/.env.production"]:
    ignored = subprocess.run(["git", "check-ignore", "-q", path], capture_output=True).returncode == 0
    check(f"{path} is ignored", ignored)
check(
    ".env.example is publishable",
    subprocess.run(["git", "check-ignore", "-q", ".env.example"], capture_output=True).returncode != 0,
)

print()
print("=== nothing generated is staged ===")
# Vercel builds this repository, and a build directory is 127 MB of artefacts that
# belong in no history. The rule that covers them is `.next/`, and a sibling named for a
# temporary directory is not matched by it — which is how a build output got staged once.
# This asserts the shape rather than the instance: whatever is ignored must not be
# something the platform would produce and a reader would never want to read.
for generated in ["frontend/.next", "frontend/.next.stashed", "frontend/.nextprobe", "frontend/node_modules", "node_modules"]:
    # With a trailing path, not the directory itself: git does not report a directory as
    # ignored by pattern alone, so probing the directory name reads as "not ignored" even
    # when a file inside it is. Probing a path within it is what the platform's checkout
    # would actually hit.
    probe = f"{generated.rstrip('/')}/x"
    ignored = subprocess.run(["git", "check-ignore", "-q", probe], capture_output=True).returncode == 0
    check(f"{generated} is ignored", ignored, probe)

staged = subprocess.run(
    ["git", "diff", "--cached", "--name-only"], capture_output=True, text=True
).stdout.splitlines()
big = [
    path
    for path in staged
    if not (path.endswith((".py", ".ts", ".tsx", ".json", ".md", ".yml", ".css", ".cjs", ".example"))
            or path in {".gitignore", ".env.example", "vercel.json"})
]
check("nothing staged is an artefact", not big, f"{len(big)} unexpected: {big[:4]}" if big else "all source")

print()
print("=== the build works with no environment set ===")
# The Vercel default case. Every variable is stripped, the build directory is removed so
# nothing stale can be mistaken for success, and the build is run.
saved = {name: os.environ.pop(name) for name in list(os.environ) if name.startswith("NEXT_PUBLIC_")}
for name in saved:
    notes.append(f"note: {name} was set in this shell and was cleared for this build")

# The build directory is deliberately NOT moved aside first. That was the original
# approach, and it fails on Windows with "directory is not empty" whenever a dev server
# is running, because the server keeps writing into .next while it is being moved. It
# also protects nothing: a stale BUILD_ID cannot make a failed build look successful,
# because `next build` exits non-zero and that is what is checked. So the exit code is
# the whole test, and the build is allowed to overwrite its own output in place.
npm = shutil.which("npm.cmd") or shutil.which("npm")
if not npm:
    sys.exit("npm not found on PATH")
proc = subprocess.run([npm, "run", "build"], capture_output=True, text=True, shell=False)
built = proc.returncode == 0
check("builds with no NEXT_PUBLIC_* set", built, "" if built else f"exit {proc.returncode}")
check("and leaves a build to serve", pathlib.Path("frontend/.next", "BUILD_ID").exists())
if not built:
    print(proc.stdout[-1200:])
    print(proc.stderr[-1200:])
for name, value in saved.items():
    os.environ[name] = value

print()
for note in notes:
    print(f"  {note}")
print()
if failures:
    print(f"{len(failures)} problem(s) — Vercel would not deploy this cleanly:")
    for failure in failures:
        print(f"  {failure}")
    sys.exit(1)
print("this repository builds the way Vercel will build it, with nothing configured")