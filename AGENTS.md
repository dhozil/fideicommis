# AGENTS.md — Fideicommis

## Project identity

- Project: Fideicommis
- Contract: `Fideicommis` in `contracts/fideicommis.py`
- Primary language for the contract: Python, executed in GenVM
- Primary chain: GenLayer, Studionet for verification
- Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Frontend: Next.js 16 App Router in `frontend/`, read-only with an optional wallet

## What this is

An autonomous trust: an estate entrusted in perpetuity, administered under its own
charter, judged by a committee of validators, funding whoever keeps it alive.

It is explicitly **not a DAO**, and the README's "What this is, and what it is
not" is not marketing. The live trust has one member holding 100% of the shares,
and the most important limitation is stated plainly: a one-member trust is
governed by one person. The contract removes the operator's ability to
*manufacture* that arrangement unilaterally. It cannot create pluralism.

## The rules the contract must keep

Breaking any of these changes what the project claims to be, so a change that
touches one needs a test that fails without it.

1. **Storage fields are appended, never inserted.** GenLayer's layout is
   positional. A field inserted mid-list silently reinterprets every field after
   it. `test_storage_layout_is_frozen_append_only` pins all 44 names and types in
   order, and the class carries an `APPEND` comment marking the boundary. Both
   exist because a comment alone is not a test, and this rule went unenforced for
   most of the project's life.
2. **No float division, anywhere.** `tests/test_no_float.py` inventories every
   division in the contract and fails on a float one. A float in
   consensus-executed code crashes the VM instead of returning a wrong number.
3. **The runner stays pinned.** `contracts/fideicommis.py` carries the `Depends`
   header for `py-genlayer:1jb45aa8yn…`, and CI lints it. There is exactly one
   contract file; see "Why there is one contract".
4. **A payout declares its conservation bucket.** `_pay` takes a bucket argument
   and rejects an unrecognised one *before* any value moves, so a new payout path
   cannot leave the estate without appearing in the identity
   `inflow == treasury + granted + settled + dissolved + keeper_paid + burned`.
5. **Model output never becomes constitution.** `ADAPT` records the model's
   suggestion as an advisory log note; the amendment body starts empty; an
   amendment with no charter text cannot execute. Validators agree on the
   *action*, never on the prose, so prose must not be load-bearing.
6. **A constitutional change waits.** Quorum, the ceiling, membership, the
   rulebook, the evidence sources and the charter all move only through a
   `GOVERNANCE` proposal, and only after a member vote plus the timelock. The
   delay is stamped when quorum is *reached*, not when submitted.
7. **The hard limits are constants.** `MIN_QUORUM_BPS` and
   `MAX_SPEND_CEILING_BPS` are not policy. A vote can tighten the trust and never
   loosen it past them.

## Reading the chain

Three facts about Studionet that are not guessable and that every driver here
encodes:

- Only a browser-like User-Agent gets through. The Python SDK does not, so
  `gltest` cannot reach Studionet at all; use the Node SDK.
- 30 requests a minute, 500 an hour, rejected with `-32029` and a
  `retry_after_seconds` hint.
- **A transaction can reach `ACCEPTED` and `FINALIZED` and still have rolled
  back.** Only `consensus_data.leader_receipt[0].result.payload` says which
  happened. Every driver checks it, and the receipt's hash against the
  transaction submitted, because a receipt from an earlier transaction looks
  exactly like a success.

## Layout

```
README.md      the overview: what it is, how it works, what is guaranteed
FINDINGS.md    the record of what was wrong and what closed it
contracts/     the contract. one file.
tests/         direct mode (no network), plus integration for a real node
scripts/       Studionet drivers, all sharing scripts/studionet.cjs
frontend/           the audit reader
deploy/        deployScript.ts
tools/         run_glsim_windows.py
```

## Commands

```bash
pip install -e ".[dev]"
python -m pytest -q                   # direct mode, no network, no model calls
genvm-lint check contracts/fideicommis.py

gltest tests/integration -v -s --network studionet   # real consensus

npm install && npm run dev            # the reader, from the repo root
npm run typecheck
python check_bundle_guard.py           # the reader's server-only guard, on Windows

node deploy/deployScript.ts --dry-run
```

## Verifying a change

The order that catches the most, because each layer has caught something the
others did not:

1. `python -m pytest -q` — 117 tests, including the adversarial capture sequence.
2. `genvm-lint check` on the contract.
3. A live run on Studionet. This is where the reader's throttling bug and the
   driver's hardcoded cycle count were found. Neither the test suite nor the
   linter reported either of them. It is also where the consensus suite finally ran,
   and where two claims in this file turned out to be false.
4. For the reader, a screenshot. Both of its bugs were things only a rendered
   page showed: a cache-truncated label and a 500 where a 404 was the honest
   answer.
5. `python check_docs.py`. Two documents that quote the same figures drift apart, and
   a reader has no way to tell which one to believe. The method count, the field count,
   the hard limits and every internal link are asserted against the contract.
6. `python check_bundle_guard.py`. The reader's two server-only checks are one line
   of `server-only` away from becoming silent, and CI's version of them was
   checking the wrong thing until a build proved it.
7. `python check_layout.py`. A layout can go cramped and still render perfectly — 200
   on every page, nothing visibly broken — so the widths are asserted against the
   built stylesheet.

## Known environment limits

- **The consensus suite runs against Studionet and passes.** 8 tests with no model
  calls, plus 5 marked `slow` that call real models:
  `gltest tests/integration -v -s --network studionet`, then `-m slow`. The public
  node is occasionally flaky, so a single run may show one failure that is a 502 or
  an SSL EOF rather than a defect; re-run before believing it. Ten minutes for the
  fast eight is normal, because every transaction goes through a real committee.
- The Node drivers under `scripts/` exist because they were the only way to drive
  Studionet before this was known, and they still verify more than the suite does:
  receipt-hash correlation and a full autonomous cycle. Keep both.
- The local `glsim` bundle has two defects, both measured rather than assumed and both
  recorded in `tests/integration/conftest.py`. It only honours `@allow_storage` on a
  module it has not already loaded, so a repeated deploy of one source fails with a
  message that names a class carrying the decorator; `staged_contract()` works around
  that by deploying a unique copy per test. And `genlayer-test` 0.29.2 cannot build
  a usable contract handle against a local node, because its schema comes back empty
  from the RPC fallback chain. A local node is therefore a worse place to verify than
  the hosted one, which is not what anyone assumes.
- **Two claims this file used to make were false and are the reason the suite never
  ran.** "gltest cannot reach Studionet (User-Agent filtering)": the mechanism is
  real, Cloudflare answers error 1010 to a `urllib` User-Agent, but gltest goes
  through `requests` and gets through fine. The project was describing a limitation
  of its own hand-rolled reachability probe. And "the local engine is stricter about
  `@allow_storage`", which a 12-line control contract disproved. Wrong reasons cost
  more than none, and both were found only by measuring.
- `gltest.config.yaml` sets no `networks` block on purpose. Declaring one REPLACES
  the presets instead of extending them, so a file naming only localnet makes
  `--network studionet` fail with "Unknown network". Measured.
- The suite needs the `gltest` CLI, not plain `pytest`, and the discriminator is
  `sys.argv[0]`. Under plain `pytest` it skips with the command to run.
- `tools/run_glsim_windows.py` carries the Windows workarounds for glsim.

## Contributing

`CONTRIBUTING.md` has the same rules in checklist form. `SECURITY.md` states what
the contract enforces without trust in the operator and, separately, what no
contract can enforce — the second list is the more useful one.

## Why there is one contract

`contracts/` holds a single file. Two `gl.Contract` subclasses cannot coexist in
one VM instance, in one file or imported from two modules, because
`__known_contract__` is a single global in the SDK namespace, so a second one
raises `only one contract is allowed`. Two contracts therefore means two
deployments, and merging the classes into one was never available.

Storage semantics used to be pinned by a fixture contract alongside it. That was
the wrong shape: a test of a proxy proves the proxy still agrees with itself. The
three behaviours `Fideicommis` actually depends on are now asserted through
`Fideicommis` itself, in `tests/test_fideicommis.py`. Two others the fixture also
pinned, `if key in self.tree` and `inmem_allocate`, appear nowhere in the contract
and are no longer asserted, because asserting them would block a runner upgrade
for a path this project never executes.

## Why there is no factory

There was one, and it was removed. A factory has to be the only thing that can
create a trust, and it has to decide once and forever what code every future trust
will run. Ours did that with a single key that `provision_template` locked in and
no governance path could ever change, which is a permanent unrevocable authority
over the platform.

That is the same shape as the four-call capture this project spent several passes
closing, only quieter, and it was the operator's to use. What remains is the
stronger property: **whoever deploys a trust is whoever chose to**, and no key
anywhere decides what code anyone else may run.

The registry the factory kept, name to address, moved off-chain to the reader's
landing page. A directory of live trusts was worth keeping; on-chain state
controlled by one address was not.
