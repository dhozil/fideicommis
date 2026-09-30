# Changelog

All notable changes to Fideicommis are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the
contract's public interface.

The public interface that matters is the set of `get_*` view methods, the
`GOVERNANCE` instruction format, and the storage layout. A change to any of those
is a major version, because deployed trusts keep their state and the layout is
positional.

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

- The static `viewer/` remains as a dependency-free alternative and as the
  simplest way to read a trust with one `node` command. The Next app supersedes
  it as the primary reader.
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
- `viewer/` and `scripts/serve_viewer.cjs`: a read-only audit page. Three static
  files, no build step, no dependencies, no account, no write path.
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
