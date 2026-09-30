# Changelog

All notable changes to Fideicommis are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the
contract's public interface.

The public interface that matters is the set of `get_*` view methods, the
`GOVERNANCE` instruction format, and the storage layout. A change to any of those
is a major version, because deployed trusts keep their state and the layout is
positional.

## [0.6.0] — one contract, and no key that owns the future

Three of the four findings below are things the project claimed and did not have.
The storage layout was the project's first rule and nothing enforced it; the reader
was not reading a trust the node would answer; and the CI guard for the reader was
failing on correct code while unable to catch a real leak.

The factory is gone. That makes the project one contract, one file, and it removes
the quietest capture in the codebase.

### Removed

- `FideicommisFactory`, `tests/test_fideicommis_factory.py`, the two factory
  integration tests, `scripts/run_factory_check.cjs`, and the factory guards inside
  the contract, the tests, the CI workflow and the reader.
- The `provision_template` step, the frozen 80 KB template, and the duplicate-name
  check it needed.
- `contracts/storage_semantics.py` and `tests/test_storage_semantics.py`.
  `contracts/` is one file now, and the storage behaviours that survived the move
  are asserted through `Fideicommis` itself rather than through a proxy — see
  "Storage semantics, asserted where they are used" below.

### Why

`provision_template` was deployer-only, ran once, and refused every later call by
design: "this factory is frozen". So one address permanently fixed the code that
every trust created through that factory would ever run, with no governance path
out of it.

In a project whose claim is that the operator cannot manufacture authority
unilaterally, that is a fifth capture — the same shape as the four-call one, only
quieter, and it was the operator's to use. It also had no working justification: it
existed because a single-file deployment cannot read a sibling file, and every
meaningful live run deployed `fideicommis.py` directly.

### What is left

Whoever deploys a trust is whoever chose to. No key decides what code anyone else
may run. The name-to-address registry the factory kept moved off-chain, to the
reader's landing page, because a directory of live trusts was worth keeping and
on-chain state owned by one address was not.

Also checked and recorded: two `gl.Contract` subclasses cannot coexist in one VM
instance, in one file *or* imported from two modules, because `__known_contract__`
is a single global in the SDK namespace. Two contracts therefore means two
deployments, and merging the classes was never available. An experiment verified
it; the result is in this repository's history rather than as a stale comment.

### Storage semantics, asserted where they are used

The fixture contract existed to pin the GenVM storage behaviours the trust relies
on, so a runner upgrade that changed one would fail loudly instead of quietly
corrupting proposal records. That reasoning was right. The shape was wrong: a
test that pins a behaviour of a proxy proves the proxy still agrees with itself,
and a runner upgrade would have left the trust unpinned anyway, because the
fixture and the contract would have been tested by different code.

Three of the five behaviours the fixture pinned are actually used, and are now
asserted through `Fideicommis`, in tests named `test_nested_dynarray_*`,
`test_a_nested_list_is_written_exactly_once` and
`test_tremap_get_falls_back_to_zero_for_an_unknown_address`. Two are not used at
all — `if key in self.tree` and `inmem_allocate` appear nowhere in the contract —
and are no longer asserted, because pinning them would block a runner upgrade for
a code path this project never executes.

Writing them against the contract changed one test into a different test. The
obvious assertion to write was "reassigning a nested list replaces it, it does not
extend it", but that is unreachable through the public API: `assess_proposal`
raises "was already assessed" before it touches the field, so a nested list is
assigned exactly once. The guard is a stronger guarantee than the semantics
question it made unaskable.

### The storage layout is now pinned by a test

`test_storage_layout_is_frozen_append_only` freezes all 44 field names and types in
order, parsed with `ast` rather than a regex so an annotation inside a method cannot
be mistaken for a field. The rule was the project's first rule and had only a
comment enforcing it, which is how it stayed unenforced for most of the project's
life.

Both of its checks were shown to be load-bearing by breaking the contract on
purpose. Inserting a field in the middle failed on the count. Swapping two adjacent
fields, keeping the count and every type identical, failed on the pairwise
comparison. Only the second check can see that edit.

### A trust that had grown too expensive to read

The reader spent ten fixed reads plus two per proposal, with no ceiling. A trust is
an estate in perpetuity, so the proposal count only rises: 20 proposals cost 50
calls, 100 cost 210, and 1,000 could not be read at all. The node allows 30 a minute
per IP with no way to reserve any, so a retired but healthy trust would have become
unreadable exactly when it mattered. Serialising the calls had fixed the concurrency
and left the arithmetic.

Seven redundant calls are gone — the page fetched `get_status`, `get_cycle`,
`get_treasury`, `get_runway_cycles`, `get_last_action`, `get_charter_version` and
`get_org_name` individually while `get_org_summary` already returned all seven.
Proposals are capped at the newest nine, derived as
`(30 - 2 slack - 10 fixed) / 2 = 9` so the cap cannot drift from the node's limit,
and capped means a trust with 10,000 proposals costs the same 28 calls as one with
none. A 45-second deadline is checked between proposals for the case the count does
not catch, which is a slow node rather than a large trust.

Verified against the live trust: ten of ten fixed reads answer, and the summary
supplies all seven fields the reader used to fetch separately.

### CI's server-only check was checking the wrong thing

The step grepped client bundles for `gen_call|createClient|genlayer-js`. That is
wrong twice. `actions.ts` and `wallet.ts` are client modules that sign through the
user's own wallet and genuinely need the SDK, so the step failed on a bundle
behaving exactly as designed. And it could not have caught a real leak, because
`server-only` is enforced by the compiler: writing a client component that imports
the reader fails the build outright, so no bundle ever exists to grep.

What replaced it checks the two things the compiler cannot. That both modules still
declare `server-only`, since deleting one line would turn a compile-time guarantee
into a silent one. And that no client component reaches the reader transitively,
which the compiler does not check. Both were shown to fail when violated.
`check_bundle_guard.py` is the same two checks in Python, for a Windows
contributor, and it is what CI runs as well as the bash versions.

117 direct-mode tests, genvm-lint green.

## [0.5.0] — the audit reader, as a full-stack application

The reader that makes "a trust that cannot explain a decision cannot be audited"
checkable by clicking, rather than by reading a document.

### Added

- `web/`: Next.js 16, App Router, React 19, TypeScript strict with
  `noUncheckedIndexedAccess`. Server-rendered audit records at `/trust/[address]`,
  `force-dynamic` so a record is never baked into a build.
- The chain client (`web/src/lib/genlayer.ts`) is built with **no account**,
  because reads do not need one, and `server-only` on that module makes importing
  it into a client component a build error rather than a review comment.
- A degraded read path: a view that fails is shown as empty and named, not
  guessed and not fatal. A trust that has not derived its rulebook yet is a normal
  state, so the page still renders everything else.
- `/api/health`, which reports whether the GenLayer node is answering and whether
  this reader is rate-limited, alongside `readOnly`, `signs: false` and
  `holdsKeys: false` as assertions rather than claims.
- CI job for the reader: typecheck, build, and two greps — that no chain client
  code reached a client bundle, and that no key material is referenced in the app
  source.

### Changed

- The static `viewer/` and its relay are removed. They were a second implementation
  of the same reader — the same pacing, the same conservation arithmetic, the same
  decision chain, the same design tokens — and two implementations of one thing rot
  on every contract change. `web/` is the reader.
- `set_policy` docstring and README examples now show three arguments, matching
  the contract. The earlier five-argument form appeared in the CLI walkthrough
  and would have failed on a call.

### Fixed

- An address with no contract behind it threw a raw SDK error and produced a 500.
  It is now a 404 that explains what a Fideicommis answers, because a wrong
  address is a user error and not a server fault.
- A rate-limited node produced a bare 500 instead of the one instruction that
  actually helps. The error boundary now says the limit is 30 reads a minute and
  offers a retry.

## [0.4.0] — the operator could take the whole estate

The capture path closed, and the constitution became checkable from outside.

### Fixed

- **Quorum and the spend ceiling are no longer parameters of `set_policy`.** They
  were, and they were the load-bearing step of a four-call capture: raise the
  ceiling to 100%, drop quorum to 1 basis point, become the only member, vote
  alone. `set_policy` now takes `(burn, keeper_reward, tick_interval)` only.
- **`set_member_shares`, `clear_rules` and `set_evidence_urls` are no longer
  operator powers.** Each refuses and names the `GOVERNANCE` field that replaces
  it. Changing who votes, what rules the committee judges by, or what evidence it
  can see is a constitutional act, and it now takes a member vote.
- **Model prose can no longer become the charter.** `ADAPT` wrote the model's
  `rationale` straight into an amendment body while validators agreed only on the
  action. The suggestion is now an advisory `adaptation_suggested` log entry, the
  body starts empty, and `execute_proposal` refuses an amendment with no charter
  text.
- **A receipt is only believed once its hash matches the transaction just
  submitted.** The Studionet drivers read `leader_receipt[0]` without checking
  which transaction it belonged to, so a receipt from an earlier transaction
  looked like success and a verification script would report it as one.

### Added

- `GOVERNANCE` proposals with a strict `FIELD:VALUE` body: `QUORUM_BPS`,
  `SPEND_CEILING_BPS`, `MEMBER_SHARES`, `CHARTER_RULES`, `EVIDENCE_URLS`. Every
  value is re-validated in the contract; a vote authorises an intent, the contract
  decides whether the intent is legal.
- A timelock on constitutional changes, stamped when quorum is *reached* rather
  than when the proposal was submitted, so a proposal that sat unvoted for a month
  does not execute the instant it is approved. Grants are not timelocked.
- `MIN_QUORUM_BPS` and `MAX_SPEND_CEILING_BPS` as hard constants. A vote can
  tighten the trust and never loosen it past them.
- `get_constitution` and `get_constitutional_state`, separate on purpose: the
  first returns only what a vote cannot change, so a caller can assert on it.
- `web/`: the read-only audit reader, replacing a static version. Next.js 16, App
  Router, React 19, TypeScript strict with `noUncheckedIndexedAccess`.
  Server-rendered audit records at `/trust/[address]`, `force-dynamic` so a record
  is never baked into a build.
- `.github/workflows/ci.yml`, which gates on `genvm-lint`, the full suite, and an
  assertion that the factory's template marker is present in the contract.

### Changed

- 133 direct-mode tests, up from 117. Eight of the new ones are adversarial: the
  full four-step capture sequence, the hard limits, the timelock, and that a grant
  is never timelocked.

## [0.3.0] — the accounting was a claim, not a check

- Every payout declares which conservation bucket it belongs to, and `_pay`
  refuses a bucket it does not recognise *before* moving any value. The identity
  `inflow == treasury + granted + settled + dissolved + keeper_paid + burned` is
  now falsifiable, with five tests covering grants, settlement, burn and keeper
  rewards together, dissolution, and a rejected unbucketed payout.
- A live driver bug: `run_mission_loop.cjs` drove a hardcoded 3 cycles, so a trust
  with a larger runway never reached `DORMANT` and its own dormancy check passed
  for the wrong reason. The cycle count now comes from the on-chain runway.

## [0.2.0] — Fideicommis

- Renamed from `UnstoppableOrg` to `Fideicommis`, and from "autonomous
  organization" to "fideicommis", on the grounds that a fideicommis is
  entrustment held in perpetuity and everything this contract does is a property
  of one, while nothing it does is a property of a DAO.
- An earlier version of the README claimed a live autonomous `ADAPT` charter
  amendment. It never happened: the model's proposed charter was written into the
  amendment body, was never proposed by a member, and did not reach quorum. The
  claim was removed rather than the gap papered over.
- `charter_amendment` and `amend_charter` renamed to `CHARTER_AMENDMENT` and the
  charter that results is versioned and kept in `charter_history`.

## [0.1.0] — first working trust

- The contract: a charter, a mission, a rulebook derived from the charter by a
  validator committee, a treasury, proposals, assessments, votes, grants, a
  delivery review, a settlement, and a permissionless cycle that pays its own
  keeper and burns a per-cycle amount.
- `DORMANT` and revival: an estate that cannot fund another cycle stops acting,
  and any `fund()` revives it permanently.
- A factory that provisions its template through calldata, after the first
  version failed on every deployment because it read its child from
  `/contract/fideicommis.py` and a single-file deployment has no sibling files.
- Live verification on Studionet: funding loop to `DORMANT` and back, the
  rejection path, the full grant and settlement path, the factory path.
