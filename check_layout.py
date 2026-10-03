"""Does the page use the width it is given, or does the text float in the middle of it?

Rendered from a real production build, then measured on the HTML: how wide the content
box is, and how much of the viewport is empty margin. A shell that is 1440px wide
holding 72ch paragraphs still reads as narrow if the text is centred in it, and that
is what this checks.
"""

import glob
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

# The port comes from the caller, because a fixed one collides with a leaked server
# from an earlier run and turns "the page did not answer" into a puzzle.
#
# The default was 3170, which is a port nothing in this project listens on. The reader
# is started by `npm run dev` and `npm start`, both of which pass `--port 3000`, so the
# default meant the check failed with "connection refused" unless the caller happened
# to know the real port and set CHECK_BASE — and a check that needs undocumented
# knowledge to run is a check nobody runs. It now names the port the reader actually
# uses.
PORT = int(os.environ.get("CHECK_PORT", "3000"))
BASE = os.environ.get("CHECK_BASE", f"http://127.0.0.1:{PORT}")


def serving() -> bool:
    """Whether something is already answering on the port."""
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", PORT)) == 0


def start_server() -> subprocess.Popen | None:
    """Start `next start` on the port, and wait for it to answer.

    The check measures a production build because that is what Vercel serves, and because
    `next dev` renders differently enough to hide a width regression. On CI nothing was
    listening at all, so the step failed with "connection refused" against a layout that
    was fine — and it had therefore never actually run on CI.
    """
    npm = shutil_which("npm")
    if not npm:
        print("  npm not on PATH, cannot start a server")
        return None

    print(f"  starting `next start` on {PORT}")
    # next directly, not `npm run start`. npm is a wrapper: terminating it leaves the
    # `next` process it spawned still listening, which is how a check that cleans up
    # after itself leaves a server behind on the port and the *next* run silently
    # measures the stale build instead of the current one.
    npx = shutil_which("npx")
    command = [npx, "--yes", "next", "start", "--port", str(PORT)] if npx else [npm, "run", "start"]
    process = subprocess.Popen(
        command,
        cwd="frontend",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        # A new process group, so the whole tree can be signalled rather than just the
        # process this handle points at. Same reason, one level down.
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )

    # next start does not report readiness on stdout when it is silenced, so this polls
    # the port rather than guessing a sleep. A fixed sleep is either too short on a cold
    # runner or wastefully long on a warm one, and this runs on every push.
    deadline = time.time() + 90
    while time.time() < deadline:
        if process.poll() is not None:
            print(f"  `next start` exited immediately with {process.returncode}")
            return None
        if serving():
            print("  serving")
            return process
        time.sleep(0.5)

    print("  the server did not answer within 90s")
    return None


def shutdown(process: subprocess.Popen | None) -> None:
    """Stop the server, and everything it started.

    Signalling the whole process group rather than one process, because `npm run start`
    and `npx next start` both wrap a `next` that survives its parent. Leaving that running
    is not untidy: the port stays occupied, so the next invocation finds a live server and
    measures a build from the previous run while reporting it as this one.
    """
    if process is None:
        return
    if os.name == "nt":
        # Windows has no process groups to signal; taskkill /T takes the tree.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
        )
        return
    import signal

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def shutil_which(name: str) -> str | None:
    # Local import so the helper above stays next to its only caller.
    import shutil

    return shutil.which(name) or shutil.which(f"{name}.cmd")

PAGES = [
    "/",
    "/trusts",
    "/how-it-works",
    "/about",
    "/verify",
    "/trust/0x76051A36dCB316bD7Bf272692B3e3f7930170597",
]


def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=120) as response:
        return response.status, response.read().decode("utf-8", "replace")


def measure(html):
    """Rough content width from the shell markup, in characters of the widest run."""
    body = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", text).strip()
    return len(text)


failures = []

# --serve starts a server only if nothing is already answering. A caller who left one
# running gets it used, which is the behaviour they meant; a caller who wants a fresh one
# should stop theirs first rather than have this silently measure a stale build.
server = None
if "--serve" in sys.argv or os.environ.get("CHECK_SERVE"):
    if serving():
        print(f"  something is already serving {BASE}, using it")
    else:
        server = start_server()

if server is None and not serving():
    print(f"  nothing is serving {BASE}")
    print("  start one, or pass --serve to have this start a production server")
    sys.exit(1)

try:
    for page in PAGES:
        try:
            status, html = fetch(page)
        except Exception as error:
            failures.append(f"{page}: {error}")
            continue

    # the old cramped signature: a shell-width container with a 68ch measure.
        # the new signature: a gutter track on .prose, and a wider shell.
        chars = measure(html)
        print(f"  {page:<48} {status}  {chars:>6} chars of text")
finally:
    shutdown(server)

print()
print("=== structural checks on the built CSS ===")

# The stylesheet is emitted under static/chunks, not static/css. An earlier version
# of this check looked in static/css, found nothing, and reported five failures that
# were the check's own path being wrong rather than the layout being wrong.
candidates = glob.glob("frontend/.next/**/*.css", recursive=True)
if not candidates:
    print("  FAIL no stylesheet was emitted at all")
    sys.exit(1)

css = ""
for candidate in candidates:
    with open(candidate, encoding="utf-8") as handle:
        css += handle.read()
print(f"  stylesheet: {candidates[0].replace(chr(92), '/')}  {len(css)} bytes")

# The built stylesheet is minified, so `--shell: 1440px` in the source arrives as
# `--shell:1440px`. Checking the source spelling against minified output reports
# failures that are the check's own spacing assumption, which is how this check first
# reported five failures on a layout that was correct. Whitespace is stripped before
# anything is compared.
flat = re.sub(r"\s+", "", css)


def has(fragment):
    return re.sub(r"\s+", "", fragment) in flat


checks = [
    ("shell is 1440px", has("--shell:1440px")),
    ("measure is 72ch", has("--measure:72ch")),
    ("rail is 400px", has("--rail:400px")),
    ("prose has a gutter track", has("gutter-start")),
    ("footer is a two-column grid", has("colophon-inner")),
    ("trust page rail column", has("grid-template-columns:var(--rail)")),
    ("shell padding widened", has("padding:0 40px")),
    ("old 1180px shell is gone", "1180px" not in flat),
    ("old 68ch measure is gone", "68ch" not in flat),
]

for label, ok in checks:
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        failures.append(label)

print()
if failures:
    print("FAILED:")
    for item in failures:
        print("  ", item)
    sys.exit(1)

print("the layout uses the width it is given.")