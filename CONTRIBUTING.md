# Contributing

The contract's correctness arguments depend on tests that would fail if a guard
were removed, so contributions that change a guard need to change a test with it.

## Setup

```bash
pip install -e ".[dev]"
python -m pytest -q          # 133 passed, 10 skipped, no network, no model calls
```

The skips are the integration tests. They skip themselves when no node is
reachable; see [Integration tests](#integration-tests) in the README. A skipped
test is not a passing test, and the README says so.

## Before you open a pull request

```bash
genvm-lint check contracts/fideicommis.py
genvm-lint check contracts/fideicommis_factory.py
python -m pytest -q
for f in scripts/*.cjs; do node --check "$f"; done
cd web && npx tsc --noEmit && npm run build
```

CI runs all four. It also asserts that the factory's `ORG_CONTRACT_MARKER` string
is present in the contract, because renaming the class without the marker is a
break that no local test would notice.

## Rules the contract has to keep

These are not style preferences. Changing any of them changes what the project
claims to be.

1. **Storage fields are appended, never inserted.** GenLayer's storage layout is
   positional, so a field inserted in the middle silently reinterprets every field
   after it. See the `APPEND` comment on the class.

2. **No float division, anywhere.** `tests/test_no_float.py` inventories every
   division in the contract and fails on a float one. A float reaching
   consensus-executed code crashes the VM rather than returning a wrong number.

3. **The runner stays pinned.** `# { "Depends": "py-genlayer:1jb45aa8yn…" }`. The
   factory refuses a template without it.

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

The README's "Known limits" and "What this does not fix" are load-bearing. If you
find a hole, the useful report is the shortest sequence of calls that reaches it,
plus what you expected the contract to refuse and which guard you think was
bypassed. Adversarial tests are the highest-value contribution to this project.
