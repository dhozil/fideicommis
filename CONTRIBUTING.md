# Contributing

The contract's correctness arguments depend on tests that would fail if a guard
were removed, so contributions that change a guard need to change a test with it.

## Setup

```bash
pip install -e ".[dev]"
python -m pytest -q          # 117 passed, 8 skipped, no network, no model calls
```

The skips are the integration tests. They skip themselves when no node is
reachable; see [Integration tests](#integration-tests) in the README. A skipped
test is not a passing test, and the README says so.

## Before you open a pull request

```bash
genvm-lint check contracts/fideicommis.py
python -m pytest -q
for f in scripts/*.cjs; do node --check "$f"; done
npm run typecheck --workspace frontend
npm run build --workspace frontend
python check_bundle_guard.py
python check_layout.py
npx tsx@4 tests/check_equivalence.ts
npx tsx@4 tests/check_explorer.mts
```

CI runs all nine. The npm commands install and run from the repository root because
it is an npm workspace: `npm ci` inside `frontend/` installs only that member and skips
the hoisting that lets `next build` find react at all.

`check_bundle_guard.py` is the local copy of CI's two server-only checks. It exists
because CI runs them in bash for a Linux container, and `bash` is not a shell that
exists on Windows. It is the file to run when changing either check.

`check_layout.py` asserts the page widths against the built stylesheet. Run it after
`npm run build`. It exists because a layout can regress to cramped and still render
perfectly: every page returns 200 and nothing looks broken, so nothing fails. It also
compares against minified output, so it looks for `1440px` and not `--shell: 1440px`.

`tests/check_equivalence.ts` checks that the write path can read the Equivalence
Principle output out of every receipt shape that actually occurs, including a split
committee and a null receipt. The reader shows the chain's own consensus output rather
than a summary of it, so a receipt shape it cannot parse would show a settled
transaction with no evidence beside it — which is the exact failure this project
exists to avoid.

## If you touch the consensus suite

It is not part of the default run. Studio mode needs the `gltest` CLI, and under
plain `pytest` the suite skips itself with the command to run, because it cannot
deploy that way.

```bash
gltest tests/integration -v -s --network studionet
gltest tests/integration -v -s -m slow --network studionet
```

Two things there are measured rather than assumed, and both cost this project its
consensus suite when they were believed instead of checked. The conftest records them
in full, so read it before changing anything here.

Cloudflare does block some User-Agents, so `urllib` cannot reach Studionet, but
`requests` can and that is what `gltest` uses. And the local engine's
`@allow_storage` error is not a stricter rule: it only honours the decorator on a
module it has not already loaded, which is why every test deploys a unique copy of
the source.

## Rules the contract has to keep

These are not style preferences. Changing any of them changes what the project
claims to be.

1. **Storage fields are appended, never inserted.** GenLayer's storage layout is
   positional, so a field inserted in the middle silently reinterprets every field
   after it. See the `APPEND` comment on the class.

2. **No float division, anywhere.** `tests/test_no_float.py` inventories every
   division in the contract and fails on a float one. A float reaching
   consensus-executed code crashes the VM rather than returning a wrong number.

3. **The runner stays pinned.** Every contract file carries the `Depends`
   header for `py-genlayer:1jb45aa8yn…`, and CI lints each one.

4. **A payout declares its bucket.** `_pay` takes a bucket argument and refuses
   one it does not recognise, before moving any value. A new payout path has to
   say where its money goes in the conservation identity.

5. **Model output never becomes constitution.** If you add a path where text a
   model produced can be installed, a test asserting it cannot will have to fail,
   and that is the point.

6. **A constitutional change waits.** Anything touching quorum, the ceiling,
   membership, the rulebook, the evidence sources or the charter needs a member
   vote and then the timelock. The delay is stamped when quorum is reached, not
   when the proposal was submitted.

## Reporting something you think is wrong

The reader's /about boundaries (one member, one author, testnet) are load-bearing. If you
find a hole, the useful report is the shortest sequence of calls that reaches it,
plus what you expected the contract to refuse and which guard you think was
bypassed. Adversarial tests are the highest-value contribution to this project.
