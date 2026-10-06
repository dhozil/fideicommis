<p align="center">
  <img src="https://img.shields.io/badge/GenLayer-intelligent%20contract-c9a227?style=flat-square" alt="GenLayer intelligent contract" />
  <img src="https://img.shields.io/badge/runner-pinned-in%20%231jb45aa8yn-blue?style=flat-square" alt="pinned runner" />
</p>

# Fideicommis

**An autonomous trust on GenLayer, administered in perpetuity under its own charter, judged
by a committee of validators, funding whoever keeps it alive.**

It is not a DAO, and it does not pretend to be one. What it offers is narrower and more
checkable: a treasury whose money must reconcile to the last attoGEN, and a public record of
why every decision was made.

---

## Contents

- [What a fideicommis is](#what-a-fideicommis-is)
- [The problem this solves](#the-problem-this-solves)
- [What makes it different](#what-makes-it-different)
- [How it works](#how-it-works)
- [Mechanisms](#mechanisms)
- [The contract](#the-contract)
- [Repository structure](#repository-structure)
- [The reader](#the-reader)
- [Frameworks](#frameworks)
- [Deployment](#deployment)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Where the edges are](#where-the-edges-are)

---

## What a fideicommis is

A *fideicommis* (Latin *fidei commissum*, "by faith entrusted") is a legal structure with four
defining properties. This project is built so that all four are enforced by the chain rather
than by trust in anybody:

| Legal property | What it means | What enforces it here |
| --- | --- | --- |
| **Entrusted, not owned** | The property is held for beneficiaries; the founder's intent binds the trustee | the charter, which the founder cannot edit directly |
| **Irrevocable** | Once established it cannot be wound up by whoever created it | changing the charter needs the same assessment and vote as any other act |
| **Held for a purpose** | There is a stated reason for the trust | the mission, and the rulebook derived from the charter |
| **Administered by a fiduciary** | The trustee owes a duty to beneficiaries, not to itself | the autonomous cycle, which pays grantees and nobody else |

The common-law equivalent is a charitable trust, or a permanent endowment. Everything this
project does is a property of a fideicommis, and nothing it does is a property of a DAO.

---

## The problem this solves

An autonomous treasury has one failure mode that matters. Someone — the deployer, the
operator, or the model — ends up able to take the money, or quietly change the rules that
justified holding it, and nobody can tell afterwards.

Every other property is secondary to that one, so the design question was not "how do we make
a trust" but **what is the smallest set of things that must be impossible, regardless of who
asks?** Four were possible in an earlier version of this contract, in four calls:

```
set_member_shares(deployer, 10000)   -> the founder owns everything
clear_rules()                        -> nothing left to judge against
set_policy(0, 10000, 0, 9999, 10000) -> raise the ceiling to the whole treasury
fund()                               -> and drain it
```

All four are refused by the contract itself, and asserted as refused against live
deployments rather than only in-process. Two further powers were removed for the same reason:
an operator could point the judge at evidence sources that make anything look compliant, and
an operator could replace the contract's code in place.

---

## What makes it different

Six properties, each enforced somewhere the operator cannot reach.

**1. Every attoGEN is accounted for, not merely counted.** The estate holds a running
identity:

```
inflow == treasury + granted + settled + dissolved + keeper_paid + burned
```

Every payment declares which bucket it draws from, and an unrecognised bucket is refused
*before* any value moves. So a new spending path cannot be added without the estate becoming
unbalanced in a bucket that does not exist. This is not a report the trust publishes; it is
the shape of the payment path itself.

**2. The hard limits are constants, not policy.** Quorum cannot go below 25% and the spend
ceiling cannot exceed 50%. A vote may tighten the trust; it can never loosen it past them.
They are not parameters of any method, so there is nothing to pass.

**3. A constitutional change waits.** Quorum, the ceiling, membership, the rulebook, the
evidence sources and the charter move only through a `GOVERNANCE` proposal, and only after a
member vote plus a delay of one hour. The clock is stamped when quorum is *reached*, not when
the proposal is submitted, so a trust cannot shorten its own delay by re-voting.

**4. Model output never becomes constitution.** The committee's verdict is consensus-bound; its
rationale is recorded prose that nothing depends on. An amendment with no charter text cannot
execute, so the autonomous `ADAPT` path cannot rewrite the constitution.

**5. No key owns the future.** There is no factory and no template key. Whoever deploys a
trust is whoever chose to; no address anywhere decides what code anyone else may run.

**6. The code cannot be replaced.** GenVM locks a contract's code slot when its constructor
returns. This contract adds nobody to the upgraders list, exposes no `upgrade` method, and
offers no way to become an upgrader, so immutability is the irreversible default rather than
a promise. `get_code_upgraders()` reports the list for any address, so this is checkable from
outside rather than taken on trust.

---

## How it works

```
                        deploy  (name, mission, charter, founder, evidence urls)
                                     |
                                     v
   bootstrap_rules  --------->  charter rules derived by the committee
                                     |
   fund()  <---------------- any sender, at any time, reviving a dormant trust
                                     |
   submit_proposal  -------->  anyone may propose. Only a member may vote.
                                     |
   assess_proposal  -------->  the committee judges it against the derived rules
                                     |   a non-compliant verdict cannot be voted or paid
   cast_vote  ------------->   member votes, weighted by shares
                                     |
   execute_proposal  ------>  GOVERNANCE and CHARTER_AMENDMENT wait one hour.
                                     |    a GRANT does not: it is a payment, not a
                                     |    change to what the trust is for
   review_delivery  -------->  the committee fetches the named URL and judges it
   settle_delivery  -------->  the second tranche is released
                                     |
   advance_cycle  ---------->  anyone may advance it. The committee decides what the
                                  cycle does: burn, pay a keeper, or release a tranche.
```

A grant pays in two tranches. The first on execution; the second only after
`review_delivery` finds the delivered work evidenced by a public source the committee could
actually fetch.

---

## Mechanisms

### Consensus

`assess_proposal`, `review_delivery` and `advance_cycle` use `gl.nondet.exec_prompt`;
`review_delivery` also fetches the evidence URL with `gl.nondet.web.get`. The leader runs the
task and validators re-derive it independently, so a leader that fabricates a verdict is
caught rather than trusted. The aggregation over per-source results is a pure function of
buckets, with no free-form reasoning and no floats, so two validators that see the same
buckets reach the same answer.

### The timelock

The delay applies to `GOVERNANCE` and `CHARTER_AMENDMENT`, and `execute_proposal` checks the
proposal kind before requiring it. `op_ready_at` is stamped when quorum is reached, so the
delay cannot be shortened by adding votes early. A `GRANT` is not a constitutional change and
executes on quorum alone.

### Conservation

`_pay` takes the bucket it draws from and refuses an unrecognised one before any value moves.
The lifetime flow is the sum of six buckets plus what is still held, and the reader prints the
residue if they disagree rather than hiding it.

### VM safety

No float division appears anywhere in the contract; a float in consensus-executed code
crashes the VM rather than returning a wrong number. GenLayer's storage layout is positional,
so a field inserted mid-list silently reinterprets every field after it. The layout is
therefore frozen and append-only, and `tests/test_fideicommis.py` pins all
**44 names and types** in order, so an insertion fails the suite rather than passing it.

---

## The contract

One file, one class, **40 methods** (25 view, 15 write), **44 storage fields**.

```
contracts/fideicommis.py
  # { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

The runner version is pinned in the `Depends` header because the deployed bytecode and the
source have to agree exactly, and an unpinned runner is a way to change that underneath you.

There is no second contract and no factory. Two `gl.Contract` subclasses cannot coexist in one
VM instance, and a factory has to decide once and forever what code every future trust will
run — which would be a permanent, unrevocable authority over the platform held by whoever
deployed it.

### Public surface

| | Methods |
| --- | --- |
| Permissionless writes | `fund`, `advance_cycle`, `bootstrap_rules`, `submit_proposal`, `assess_proposal`, `review_delivery` |
| Member acts | `cast_vote` |
| Operator acts | `set_policy` |
| Deliberately refused | `set_member_shares`, `set_evidence_urls`, `clear_rules`, `upgrade`, `set_code_upgraders` |
| Views | constitution, state, policy, members, rulebook, charter, mission, mission log, charter history, evidence urls, treasury, status, lifetime flow, proposals, audits, `get_code_upgraders` |

The refused methods are kept as declarations that always revert, so calling one explains
itself instead of reporting an unknown method. Removing them entirely would leave a caller
with no answer at all.

---

## Repository structure

```
contracts/fideicommis.py     the trust. one contract, one file, 40 methods
tests/                       direct mode: 111 test functions, no network, no model calls
tests/integration/           consensus against real GenVM on Studionet
frontend/                    the reader
scripts/                     Studionet drivers, all sharing scripts/studionet.cjs
deploy/deployScript.ts       deploy entrypoint
tools/run_glsim_windows.py   Windows workarounds for the local simulator
check_docs.py                asserts the figures in this file against the contract
```

---

## The reader

`frontend/` is a Next.js 16 App Router application that reads a trust and shows what its own
view methods return. It holds no key: reads need none, and connecting a wallet is only how a
transaction gets signed.

- `/` the overview
- `/trusts` the directory
- `/trust/[address]` the full record: ledger, constitution, rulebook, every decision
- `/how-it-works` the mechanism in the order it happens
- `/verify` every view method this reader calls, what it uses the answer for, and the raw
  value it returned — so any claim here can be re-derived by making the same call
- `/about` what this does and does not establish

Every figure on every page is a `get_*` call against the trust's own contract. The page and
the contract share no data.

Four states are kept apart, because they mean different things and collapsing them would make
a wrong address look like a broken site: a wrong address answers `get_org_summary` with
nothing; an address on another network, or a wallet address, is a different contract entirely;
a rate-limited node is neither of those; and a trust whose individual views fail is rendered
with the failures named rather than hidden.

The page paints before the chain is read. The shell is served immediately and the record
arrives over a second request, so the first paint does not wait on a node that takes seconds
to answer.

---

## Frameworks

| | |
| --- | --- |
| Contract language | Python on GenVM, runner pinned |
| Static analysis | `genvm-lint` — the official linter for the pinned runner, and what CI gates on |
| Testing | `pytest`, `genlayer-test`, `gltest` — direct mode in-process; Studio mode against a committee |
| Frontend | Next.js 16, React 19 — App Router; the page paints before the chain is read |
| Chain SDK | `genlayer-js` — server-only; never reaches a browser bundle |
| Wallet | injected EIP-1193, `viem` — any wallet, chosen by name over EIP-6963 |
| Type | IBM Plex Sans, IBM Plex Mono, Newsreader — prose, data, and the charter's voice; self-hosted, SIL OFL |

---

## Deployment

The contract is deployed from source to GenLayer Studionet. `deployScript.ts` prints the
resulting address, which is a trust in its own right: anyone who deploys becomes its founder
and sole member, and can act on it immediately.

```bash
genlayer network set studionet
node deploy/deployScript.ts --dry-run
node deploy/deployScript.ts
```

Studionet cannot upgrade a contract, so each deployment is a distinct address that stands on
its own. The reader opens any of them by address; `/trusts` lists the ones this repository
knows about, and that list is a file in the repository rather than on-chain state, because a
directory of live trusts is worth keeping and on-chain state owned by one address is not.

### The live deployment

```
address    0x03D0d63AC67F4D0D478d7F506530DCFD99bA338f
name       Open Ledger Fund
status     ACTIVE     charter version 1
upgraders  []         frozen — no address can replace this code
```

Explorer: `https://explorer-studio.genlayer.com/address/0x03D0d63AC67F4D0D478d7F506530DCFD99bA338f`

`gen_getContractCode` returns the source of a deployed contract, and for the address above it
is byte-identical to `contracts/fideicommis.py`. There is no `codeHash` method in GenLayer;
the code itself is the only identity available, and comparing it is stronger than a
consistency check between two view methods.

---

## Getting started

```bash
git clone <this repo> && cd fideicommis
pip install -e ".[dev]"
python -m pytest -q
genvm-lint check contracts/fideicommis.py
```

For the reader:

```bash
npm ci                                  # an npm workspace: install from the root
npm run dev                             # http://localhost:3000
npm run typecheck
```

No environment variable is required and no key can be set to one: `lib/genlayer.ts` is
`server-only`, and the build fails rather than shipping a reader that could sign.

Deployment settings are in [`VERCEL.md`](VERCEL.md).

---

## Testing

```bash
python -m pytest -q                    # direct mode, no network, no model calls
genvm-lint check contracts/fideicommis.py

gltest tests/integration -v -s --network studionet
gltest tests/integration -v -s -m slow --network studionet

npx --yes tsx@4 tests/check_write_gating.mts
npx --yes tsx@4 tests/check_read_budget.mts
npx --yes tsx@4 tests/check_capabilities.mts
npx --yes tsx@4 tests/check_render_path.mts
npx --yes tsx@4 tests/check_degraded_panels.mts
npx --yes tsx@4 tests/check_wallet_layout.mts

python check_docs.py
python check_bundle_guard.py
python check_layout.py
```

The eight consensus tests take about six minutes, because every transaction goes through a
real committee. The five marked `slow` additionally call real models.

Two things in the suite are worth knowing before trusting it. The write gating is a pure
function in `lib/write-gating.ts` rather than inline in a component, so it can be tested
without copying it out. And the read budget is asserted against the code: the constants in
`lib/trust.ts` are checked against the number of views actually sent, because a prose figure
describing arithmetic goes stale silently.

---

## Where the edges are

Everything above is enforced by the contract or read live from it. The boundaries of that are
stated in full at [`/about`](frontend/src/app/about/page.tsx), which is where a reader should
go to decide how much weight to put on any of it.

[`SECURITY.md`](SECURITY.md) separates what the contract enforces without trust in the
operator from what no contract can enforce for you. [`FINDINGS.md`](FINDINGS.md) is the record
of what was wrong with this contract and what closed it.

---

## Licence

MIT for the contract and the reader.