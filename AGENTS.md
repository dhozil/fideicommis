# AGENTS.md — Fideicommis

## Project identity

- Project: Fideicommis
- Contract: `Fideicommis` in `contracts/fideicommis.py`
- Primary language for the contract: Python, executed in GenVM
- Primary chain: GenLayer, Studionet for verification
- Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Frontend: Next.js 16 App Router in `web/`, read-only with an optional wallet

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
   it. The class carries an `APPEND` comment marking where that boundary is.
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
contracts/     the contract. one file.
tests/         direct mode (no network), plus integration for a real node
scripts/       Studionet drivers, all sharing scripts/studionet.cjs
web/           the audit reader
deploy/        deployScript.ts
tools/         run_glsim_windows.py
```

## Commands

```bash
pip install -e ".[dev]"
python -m pytest -q                   # direct mode, no network, no model calls
genvm-lint check contracts/fideicommis.py

npm install && npm run dev            # the reader, from the repo root
npm run typecheck

node deploy/deployScript.ts --dry-run
```

## Verifying a change

The order that catches the most, because each layer has caught something the
others did not:

1. `python -m pytest -q` — 114 tests, including the adversarial capture sequence.
2. `genvm-lint check` on the contract.
3. A live run on Studionet. This is where the reader's throttling bug and the
   driver's hardcoded cycle count were found. Neither the test suite nor the
   linter reported either of them.
4. For the reader, a screenshot. Both of its bugs were things only a rendered
   page showed: a cache-truncated label and a 500 where a 404 was the honest
   answer.

## Known environment limits

- `gltest` cannot reach Studionet (User-Agent filtering). Live verification runs
  through the Node drivers.
- A locally installed `glsim` bundles an engine that rejects any `gl.Contract`
  subclass not annotated `@allow_storage`, which the pinned Studionet runner does
  not require. The integration suite therefore deploys once, reads what the engine
  said, and skips with that text rather than reporting ten failures that teach a
  reviewer to ignore red. `tools/run_glsim_windows.py` carries the Windows
  workarounds.

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
