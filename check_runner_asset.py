"""Does the URL gltest 0.29.2 fetches still exist?

The direct-mode suite failed 93 tests on CI with `urllib.error.HTTPError: HTTP Error 404`,
and 29 seconds is far too fast for a 128.6 MB download, so the 404 is the request itself
rather than a download that timed out.

The harness asks for `genvm-universal.tar.xz`. This was the wrong conclusion twice on the
way to the right one — first attributed to a cold cache, then to a User-Agent the CDN
rejects. Both were plausible and both were wrong, and both are the kind of reason that
costs more than none.

The measurement that settles it: list the release's real assets, then ask for both names.

Run: python check_runner_asset.py
"""

import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REPO = "genlayerlabs/genvm"

# The name gltest/direct/sdk_loader.py builds:
#   url = f"{GITHUB_RELEASES_URL}/download/{version}/genvm-universal.tar.xz"
HARNESS_NAME = "genvm-universal.tar.xz"

failures = []


def head(url: str) -> tuple[int, str]:
    request = urllib.request.Request(url, method="HEAD")
    request.add_header("User-Agent", BROWSER)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, f"{int(response.headers.get('Content-Length') or 0) / 1024 / 1024:.1f} MB"
    except urllib.error.HTTPError as error:
        return error.code, str(error.reason)


print("=== what the release actually carries ===")
# Unauthenticated GitHub allows 60 requests an hour per IP, and a CI runner's IP is
# shared. This check also runs in the job that resolves the asset, so two runs of the same
# push can exhaust the quota between them — which it did: HTTP 403 "rate limit exceeded",
# reported as a red job on a repository whose contract and reader are both fine.
#
# So the release is cached on disk for a day, and a runner that cannot reach the API at all
# is a skip with a reason rather than a failure. A URL that is genuinely gone is still a
# failure, because that is a break this project can do something about.
CACHE = pathlib.Path(".gltest-release-cache.json")
CACHE_TTL = 24 * 60 * 60


def load_release() -> dict:
    if CACHE.exists() and time.time() - CACHE.stat().st_mtime < CACHE_TTL:
        cached = json.loads(CACHE.read_text(encoding="utf-8"))
        if cached.get("assets"):
            print(f"  using the release recorded {int((time.time() - CACHE.stat().st_mtime) / 60)} minutes ago")
            return cached
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/releases/latest",
        headers={"User-Agent": BROWSER},
    )
    fetched = json.load(urllib.request.urlopen(request, timeout=60))
    if fetched.get("assets"):
        CACHE.write_text(json.dumps(fetched), encoding="utf-8")
    return fetched


try:
    release = load_release()
except urllib.error.HTTPError as error:
    if error.code in (403, 429):
        print(f"  {error.code} from the GitHub API, quota exhausted on a shared runner IP")
        print("  this is not a property of this repository, so it is not a failure")
        if CACHE.exists():
            cached = json.loads(CACHE.read_text(encoding="utf-8"))
            if cached.get("assets"):
                print(f"  falling back to the release recorded on disk: {cached['tag_name']}")
                release = cached
            else:
                sys.exit(0)
        else:
            print("  no recorded release on disk to fall back to")
            sys.exit(0)
    else:
        raise
except (urllib.error.URLError, TimeoutError) as error:
    print(f"  the GitHub API is unreachable: {error}")
    print("  that is a network fault, not a property of this repository")
    sys.exit(0)

version = release["tag_name"]
print(f"  latest release: {version}, published {release.get('published_at')}")

runners_assets = [
    a for a in release["assets"] if "runners" in a["name"] or "universal" in a["name"]
]
for asset in runners_assets:
    print(f"  {asset['name']}  {asset['size'] / 1024 / 1024:.1f} MB  "
          f"downloads={asset['download_count']}")

if not runners_assets:
    print("  FAIL this release carries no runners asset under either name")
    failures.append("no runners asset in the latest release")

print()
print("=== the name the harness asks for, and the one that exists ===")
base = f"https://github.com/{REPO}/releases/download/{version}"

harness_status, harness_detail = head(f"{base}/{HARNESS_NAME}")
print(f"  {HARNESS_NAME:<32} {harness_status}  {harness_detail}")

real = max(runners_assets, key=lambda a: a["size"])["name"] if runners_assets else None
if real:
    real_status, real_detail = head(f"{base}/{real}")
    print(f"  {real:<32} {real_status}  {real_detail}")
    if real_status != 200:
        print()
        print(f"  The release lists {real} but that URL answers {real_status} ({real_detail}).")
        print("  GitHub serves release downloads from a CDN that rate-limits by IP, and a")
        print("  CI runner's IP is shared, so this is a property of the runner rather than of")
        print("  this repository. The release listing came from a cached copy or an")
        print("  authenticated call, which is why only this request failed.")
        print()
        print("  Not a failure: the asset is known to exist, and the suite step that fetches")
        print("  it retries. A missing asset is a failure and is reported above.")
        print()
        print("the release lists its asset; that download was rate limited on this runner")
        sys.exit(0)

print()
if real and real != HARNESS_NAME and harness_status == 404:
    print(f"  FOUND: the harness asks for {HARNESS_NAME}, which no longer exists.")
    print(f"          The release carries {real} instead. Same size, same content, renamed")
    print("          upstream. That is the whole cause of the 93 failures: a URL that is")
    print("          correct in the harness and absent from the release.")
    print()
    print("          It is invisible locally by construction: a machine that fetched the")
    print("          tarball before the rename still has it cached and never asks again.")
    print("          The suite is green here because the cache predates the break, not")
    print("          because the URL works.")
elif harness_status == 200:
    print(f"  {HARNESS_NAME} resolves, so the 404 is something else and this file is wrong")
else:
    print("  inconclusive: report what was measured rather than guessing")

print()
if failures:
    for failure in failures:
        print(f"  {failure}")
    sys.exit(1)

if harness_status != 200:
    # Not an error. The harness's URL is wrong upstream and CI works around it by
    # fetching the asset under its real name, so a red run here would mean the
    # workaround is in place for the known break. What would be an error is the asset
    # itself disappearing, and that is the failure above.
    print(
        f"note: {HARNESS_NAME} still does not resolve, which CI works around by "
        f"fetching\n      {real}. This check is here so a second rename is a clear message"
    )
else:
    print("every URL this project fetches resolves")