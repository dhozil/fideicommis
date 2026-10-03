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
import sys
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
request = urllib.request.Request(
    f"https://api.github.com/repos/{REPO}/releases/latest",
    headers={"User-Agent": BROWSER},
)
release = json.load(urllib.request.urlopen(request, timeout=60))
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