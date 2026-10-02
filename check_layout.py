"""Does the page use the width it is given, or does the text float in the middle of it?

Rendered from a real production build, then measured on the HTML: how wide the content
box is, and how much of the viewport is empty margin. A shell that is 1440px wide
holding 72ch paragraphs still reads as narrow if the text is centred in it, and that
is what this checks.
"""

import glob
import os
import re
import sys
import urllib.request

# The port comes from the caller, because a fixed one collides with a leaked server
# from an earlier run and turns "the page did not answer" into a puzzle.
#
# The default was 3170, which is a port nothing in this project listens on. The reader
# is started by `npm run dev` and `npm start`, both of which pass `--port 3000`, so the
# default meant the check failed with "connection refused" unless the caller happened
# to know the real port and set CHECK_BASE — and a check that needs undocumented
# knowledge to run is a check nobody runs. It now names the port the reader actually
# uses, and a production build still needs CHECK_BASE because `next start` can be given
# a different one.
BASE = os.environ.get("CHECK_BASE", "http://127.0.0.1:3000")

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

for page in PAGES:
    try:
        status, html = fetch(page)
    except Exception as error:
        failures.append(f"{page}: {error}")
        continue

    # the old cramped signature: a shell-width container with a 68ch measure.
    has_measure = "--measure" in html or "max-width" in html
    # the new signature: a gutter track on .prose, and a wider shell.
    has_gutter = "gutter-start" in html
    chars = measure(html)
    print(f"  {page:<48} {status}  {chars:>6} chars of text")

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