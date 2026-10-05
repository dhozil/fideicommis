<p align="center">
  <img src="https://img.shields.io/badge/GenLayer-intelligent%20contract-c9a227?style=flat-square" alt="GenLayer intelligent contract" />
  <img src="https://img.shields.io/badge/runner-pinned-in%20%231jb45aa8yn-blue?style=flat-square" alt="pinned runner" />
  <img src="https://img.shields.io/badge/tests-117%20direct%20%C2%B7%208%20consensus-informational?style=flat-square" alt="test counts" />
</p>

# Fideicommis

**An autonomous trust on GenLayer, administered in perpetuity under its own charter,
judged by a committee of validators, funding whoever keeps it alive.**

It is not a DAO, and it does not pretend to be one. What it offers is narrower and
more checkable: a treasury whose money must reconcile to the last attoGEN, and a
public record of why every decision was made.

---

## Contents

- [What a fideicommis is](#what-a-fideicommis-is)
- [The problem this solves](#the-problem-this-solves)
- [What makes it different](#what-makes-it-different)
- [How it works](#how-it-works)
- [Mechanisms](#mechanisms)
- [Repository structure](#repository-structure)
- [The reader](#the-reader)
- [Frameworks](#frameworks)
- [Verified on a real network](#verified-on-a-real-network)
- [Getting started](#getting-started)
- [Testing](#testing)
- [What this does not fix](#what-this-does-not-fix)

> **Looking for the defects?** This page is the overview.
> [FINDINGS.md](FINDINGS.md) is the record of what was wrong with this contract and
> what closed it — the six captures, the four false claims, and the reasoning behind
> each fix.

---

## What a fideicommis is

A *fideicommis* (Latin *fidei commissum*, "by faith entrusted") is a legal structure
with four defining properties. This project is built so that all four are enforced by
the chain rather than by trust in anybody:

| Legal property | What it means | What enforces it here |
| --- | --- | --- |
| **Entrusted, not owned** | The property is held for beneficiaries; the founder's intent binds the trustee | the charter, which the founder cannot edit directly |
| **Irrevocable** | Once established it cannot be wound up by whoever created it | changing the charter needs the same assessment and vote as any other act |
| **Held for a purpose** | There is a stated reason for the trust | the mission, and the rulebook derived from the charter |
| **Administered by a fiduciary** | The trustee owes a duty to beneficiaries, not to itself | the autonomous cycle, which pays grantees and nobody else |

The common-law equivalent is a charitable trust, or a permanent endowment. The name is
chosen because it is exact rather than decorative: everything this project does is a
property of a fideicommis, and nothing it does is a property of a DAO.

---

## The problem this solves

An autonomous treasury has one failure mode that matters. Someone — the deployer, the
operator, or the model — ends up able to take the money, or quietly change the rules
that justified holding it, and nobody can tell afterwards.

Every other property is secondary to that one. So the design question was not "how do
we make a trust" but **"what is the smallest set of things that must be impossible,
regardless of who asks?"**

An earlier version of this contract had four of them. The deployer could take the whole
estate in four calls:

```
set_member_shares(deployer, 10000)   -> the founder owns everything
clear_rules()                        -> nothing left to judge against
set_policy(0, 10000, 0, 9999, 10000) -> raise the ceiling to the whole treasury
fund()                               -> and drain it
```

All four are now refused by the contract itself, and asserted as refused against a
live deployment rather than only in-process.

---

## What makes it different

Six properties, each enforced somewhere the operator cannot reach.

**1. Every attoGEN is accounted for, not merely counted.** The estate holds a running
identity:

```
inflow == treasury + granted + settled + dissolved + keeper_paid + burned
```

Every payment declares which bucket it draws from, and an unrecognised bucket is
refused *before* any value moves. So a new spending path cannot be added without the
estate becoming unbalanced in a bucket that does not exist. This is not a report the
trust publishes; it is the shape of the payment path itself.

**2. The hard limits are constants, not policy.** Quorum cannot go below 25% and the
spend ceiling cannot go above 50%, because those two numbers live in the contract code
rather than in storage. A vote can tighten the trust. It cannot loosen it past them.

**3. A constitutional change is not effective when it is approved.** The delay is
stamped when quorum is *reached*, not when the proposal is submitted, so adding votes
cannot restart the clock. This is the property a timelock is supposed to have and
frequently does not.

**4. Model output never becomes the constitution.** The model may draft charter prose,
and that draft travels as an advisory note. An amendment with no charter text cannot
execute. Validators agree on the *action*, never on the prose, so prose must not be
load-bearing.

**5. A receipt can be for the wrong transaction, and the UI used to believe it.**
Reading the transaction status is not enough — GenLayer can return `FINALIZED` for a
transaction that rolled back. Every driver and the reader read
`consensus_data.leader_receipt[0].result.payload` instead, and verify the receipt's
hash is the transaction that was just submitted.

**6. No key owns the future.** There is no factory and no template key. An earlier
version had one: a single deployer address could permanently fix the code that every
future trust would ever run, with no governance path out of it. In a project whose
whole claim is that the operator cannot manufacture authority unilaterally, that was a
fifth capture, the same shape as the four above, and it was the operator's to use.

**And the limitation, stated plainly:** a live trust here holds one member with every
share, so one approval satisfies quorum alone. The contract removes the operator's
ability to manufacture that arrangement unilaterally. **It cannot create pluralism**,
and nothing in this repository should be read as claiming that it does.

---

## How it works

The full lifecycle, in the order it happens. Every term below is the contract's own, so
you can read the same name in `contracts/fideicommis.py` and mean the same thing.

```
   anyone ──▶ fund() ────────────────▶ treasury, recorded as inflow
                    │
   anyone ──▶ submit_proposal(kind, amount, recipient)
                    │
              committee assesses against the rulebook
                    │        └─ COMPLIANT / NON_COMPLIANT / UNDETERMINED
                    │           with the model's stated reasons attached
                    ▼
              members vote, weighted by shares
                    │        └─ quorum reached: any constitutional delay starts HERE
                    ▼
              after the delay, a constitutional change may execute
                    │
   anyone ──▶ advance_cycle() ──▶ HOLD · FUND · SETTLE · ADAPT · WIND_DOWN
                    │
              └─ keeper reimbursed, burn deducted, buckets updated
```

Four points in that diagram carry the design:

- **Funding is permissionless.** Anyone may add money, and funding revives a dormant
  trust permanently. A keeper who stops does not stop the trust.
- **Advancing the cycle is permissionless** and pays its own caller. What happens in
  the cycle is decided by the committee, not by whoever called the function.
- **The clock starts at quorum.** A proposal cannot be re-voted into restarting its own
  delay.
- **Dormancy is not death.** When the runway reaches zero the trust goes dormant, and
  the only thing that revives it is someone funding it again.

At genesis the charter is set and the rulebook is **derived** from it by the model and
stored. Until that step happens the trust is identifiable but not judging anything, and
the reader says so rather than showing an empty rulebook as if it were deliberate.

---

## Mechanisms

### Consensus

The committee is the mechanism, and so is the thing being constrained. A leader
produces a decision; validators independently re-derive it from the same charter and
the same evidence; the result is accepted only when they agree.

The four equivalence rules, in plain terms:

1. **Leader and validators must produce the same output.** A leader cannot decide
   something validators will not confirm.
2. **Validators see the same inputs as the leader.** The leader cannot feed them a
   different fact and rely on the difference.
3. **Non-deterministic work is re-executed, not trusted.** Web fetches and LLM calls are
   re-run by each validator.
4. **A disagreement is an appeal, not a tie-break.** It triggers another round, not a
   vote on which validator is right.

### The timelock

Constitutional changes — charter, quorum, ceiling, membership, rulebook, evidence
sources — move only through a `GOVERNANCE` or `CHARTER_AMENDMENT` proposal, and only
after a member vote *plus* the delay. Everything else about how the trust is governed
is a normal proposal that happens to be cheap to make.

### Conservation

The identity above is checked rather than asserted. The reader recomputes the residue
from the six buckets and compares it against the contract's own `conserved_atto`, so a
disagreement between the two is visible instead of hidden.

### VM safety

GenVM executes Python. Two classes of mistake there are silent rather than loud, so
both are pinned by tests:

- **No float arithmetic anywhere in consensus code.** `tests/test_no_float.py`
  inventories every division in the contract and fails on a float one. A float in
  consensus-executed code crashes the VM rather than returning a wrong number.
- **The storage layout is positional and frozen.** Field number *N* is always field *N*.
  A field inserted mid-list silently reinterprets every field after it on every deployed
  trust. `test_storage_layout_is_frozen_append_only` pins all 44 names and types in
  order, parsed with `ast` so an annotation inside a method cannot be mistaken for a
  field.

---

## Repository structure

```
contracts/
  fideicommis.py              the trust. one contract, one file, 41 methods

tests/
  test_fideicommis.py         direct mode, 117 tests, no network, no model calls
  test_no_float.py            invariant: no float division in consensus
  integration/
    test_consensus.py         the same flows through a real validator committee

frontend/                          the audit reader, Next.js 16 App Router
deploy/deployScript.ts        one command: deploy, then read it back
scripts/                      Studionet drivers with receipt-hash correlation
tools/run_glsim_windows.py    the Windows glsim workarounds

gltest.config.yaml            network configuration for the consensus suite
check_bundle_guard.py         the reader's server-only guard, for Windows
check_layout.py               asserts the page widths against the built stylesheet
```

**Why one contract.** Two `gl.Contract` subclasses cannot coexist in one VM instance,
in one file or imported from two modules, because `__known_contract__` is a single
global in the SDK namespace. Two contracts therefore means two deployments, and merging
the classes was never available.

---

## The reader

A trust that cannot explain a decision cannot be audited. `frontend/` is that audit record,
and its strongest claim is a negative one:

> It holds no key, it cannot sign on its own, and every figure it shows is a call to the
> trust's own `get_*` method.

Connecting a wallet is how a transaction gets signed, and that happens in the wallet with
your approval, one transaction at a time. So the reader has a write path and no custody —
which is a narrower and more useful claim than "read-only", a label that was true when the
reader had no write path and stopped being true when it gained one.

So any claim on any page can be checked by making the same call yourself — and
[`/verify`](frontend/src/app/verify/page.tsx) exists to make that literally true. It lists
the complete call surface and shows what each method returned just now, as raw values.

It also takes a transaction hash. The figures above are claims about state; a hash is a
claim about a decision — whether a write settled, whether a committee was unanimous, and
whether the status field agreed. That evidence was previously visible only to whoever
signed the write, which is the wrong audience for it. It keeps four outcomes apart on
purpose: *no record*, *not yet decided*, *rolled back*, and *settled*. A node answering
"no record" for a hash it has never seen is not a committee rejecting anything, and the
page says so rather than letting the absence read as a verdict.

Five pages:

| Route | What it is for |
| --- | --- |
| `/` | the live conservation balance, read from the chain |
| `/trusts` | the directory of trusts, kept in this repo rather than on chain |
| `/trust/[address]` | the full record: ledger, constitution, rulebook, every decision |
| `/how-it-works` | the mechanism, in the order it happens |
| `/verify` | every call this reader makes and what it returned; `?tx=` reads one transaction's committee evidence |
| `/about` | what this is, and the limits it does not remove |

Three behaviours worth naming, because they are the ones that make it worth reading:

- **A disagreement between the constitution view and the state view** means the deployed
  bytecode is not what the reader expects. That is stated at the top, and the figures
  below it are marked unverified.
- **A view that fails is named, not shown as empty.** A trust that has not derived its
  rulebook yet is a normal state, not a broken page.
- **A proposal that is not shown says so**, with the count and where the full list is.
  A reader that quietly truncates is indistinguishable from one with nothing to hide.

Reads are batched and cached with request coalescing, because the node allows thirty
requests a minute per IP and a page that re-reads a trust to show the same figures is
not reading, it is re-fetching. A transaction hash is cached too, and the page says when
its answer was not read fresh — the node reports an unknown hash by throwing rather than
returning null, so the commonest answer on a hash URL is an absence, and a cache that
cannot hold an absence re-asks on every visit.

To deploy it: [`VERCEL.md`](VERCEL.md). Every Vercel setting it needs is in `vercel.json`,
including the Root Directory, because `outputDirectory` is resolved relative to it and
`frontend/` there makes the path `frontend/frontend/.next`. No environment variable is
required and no key can
be set, which `check_deploy.py` enforces rather than trusting.

---

## Frameworks

| Layer | Choice | Note |
| --- | --- | --- |
| Chain | [GenLayer](https://docs.genlayer.com) | intelligent contracts on the Equivalence Principle |
| Contract | Python 3.12, GenVM | runner pinned to `py-genlayer:1jb45aa8yn…` |
| Static analysis | `genvm-lint` | the official linter for the pinned runner, and what CI gates on |
| Testing | `pytest`, `genlayer-test`, `gltest` | direct mode in-process; Studio mode against a committee |
| Frontend | Next.js 16, React 19 | App Router; the page paints before the chain is read |
| Chain SDK | `genlayer-js` | server-only; never reaches a browser bundle |
| Wallet | injected EIP-1193, `viem` | MetaMask, Rabby, or any compatible wallet |
| Type | IBM Plex Sans, IBM Plex Mono, Newsreader | prose, data, and the charter's voice; self-hosted, SIL OFL |

The runner version is pinned in a `Depends` header because GenLayer's storage layout is
positional: the deployed bytecode and the source have to agree exactly, and an unpinned
runner is a way to change that underneath you.

---

## Verified on a real network

On Studionet, with real model calls and a real validator committee.

**The deployment that can be fully audited** is `0x0A3912aa80a403efDEf664A8e03895CCF5b137D8`,
built from the current source. Nine transactions walked the whole path — derive the rulebook,
fund, propose, have the committee judge, vote, execute, review the delivery, settle — and the
grant below pays a real beneficiary, so the money genuinely leaves the trust.

```
trust      : 0x0A3912aa80a403efDEf664A8e03895CCF5b137D8   "Open Ledger Fund"
beneficiary: 0x646454E139609564ae2bbDA7762bB4ADaA01B467
policy     : burn 0, keeper 0, tick 60s, ceiling 20 percent of treasury

[1] bootstrap_rules  -> 7 rules derived from the charter
[2] fund 1.000000    -> treasury 1.000000, ceiling 0 -> 0.200000
[3] submit_proposal  -> p1, 0.050000 GEN, verdict PENDING
[4] assess_proposal  -> COMPLIANT   violations []
[5] cast_vote        -> approvals 1, quorum reached
[6] execute_proposal -> payout, grant tranche released
[7] review_delivery  -> ACCEPTED    score 95
[8] settle_delivery  -> second tranche released, p1 settled
    ... identical for p2

inflow 1.000000 == treasury 0.805000 + granted 0.100000 + settled 0.095000
                  + dissolved 0 + keeper_paid 0 + burned 0
```

Two grants, both `COMPLIANT`, both `ACCEPTED` at score 95, both settled. The same proposal
was first refused as `NON_COMPLIANT` with violations `["BUDGET_CEILING","R1"]` while the
treasury was empty, and accepted once it was funded — the committee read the on-chain ceiling
rather than the text. A ceiling of zero makes every positive grant a violation, so the
refusal was correct and said why.

**The constitutional delay covers `GOVERNANCE` and `CHARTER_AMENDMENT` only.** A `GRANT` does
not wait: `execute_proposal` checks `kind in CONSTITUTIONAL_KINDS` before requiring the
timelock, and that branch is asserted by the timelock consensus test. A script written during
this work predicted the opposite and was wrong, which is why it is stated here.

### The earlier deployments, and what each cannot show

Four older trusts exist. All are live, and **none of them can be audited in full** — an older
build of this contract, and Studionet cannot upgrade a contract, so none of it is repairable
in place. They are listed because omitting them would present the current source as the only
thing that ever ran.

| Trust | Status | What it cannot show |
| --- | --- | --- |
| `0x76051A36…0597` | ACTIVE, 6 rules, 2 proposals | `p1` rests `NON_COMPLIANT`: its ceiling was 0 |
| `0xaEDf11fD…468aF` | ACTIVE, 8 rules, 3 proposals | `get_constitution` and `get_constitutional_state` **refuse** |
| `0x89D3E2F9…113F` | ACTIVE, 6 rules, 1 settled | Previous build; figures are that build's |
| `0x50590E26…C4DF` | ACTIVE, 2 proposals, 1 settled | Both constitution views **refuse**, and `get_lifetime_flow` returns three fields |

That last row is the important one. On `0x50590E26…` the conservation ledger **cannot be
checked at all**, because its `get_lifetime_flow` returns only `inflow_atto`,
`keeper_paid_atto` and `outflow_atto` — there are no buckets to sum. An earlier version of
this file led with that deployment as the verification, which overstated it: the identity
this project is built around is a current-source feature, and only a current-source
deployment can demonstrate it.

Also verified live on the older trusts: the funding loop with per-cycle burn and keeper
reimbursement; dormancy when the treasury empties; revival by `fund()`; the rejection path
where a surveillance grant is blocked from both voting and payment; and a charter amendment
that raised the charter from version 1 to 2 and cleared the rulebook.

The four operator captures were asserted as **refused** against a live deployment:

```
membership   set_member_shares -> refused
rulebook     clear_rules       -> refused
evidence     set_evidence_urls -> refused
5-arg policy set_policy        -> refused

quorum 5000 | ceiling 2000 | charter v1 | conservation holds
```

---

## Getting started

```bash
git clone <this repo> && cd fideicommis
pip install -e ".[dev]"
python -m pytest -q          # 117 direct-mode tests, no network, no model calls
genvm-lint check contracts/fideicommis.py
```

Deploy a trust — there is no factory and no template key:

```bash
node deploy/deployScript.ts
```

It deploys, reads the name and constitution back to confirm the deployment is real, and
prints the address. Two steps are then left to you on purpose:

1. `bootstrap_rules` — derive the rulebook the committee judges by.
2. `fund()` — anyone may do this, and funding revives a dormant trust.

Then open the address in [the reader](#the-reader).

---

## Testing

Three layers, because each catches what the others cannot.

```bash
python -m pytest -q                    # 117 tests, direct mode, ~11s
genvm-lint check contracts/fideicommis.py

# the consensus suite, against a real committee
gltest tests/integration -v -s --network studionet
gltest tests/integration -v -s -m slow --network studionet
```

The eight consensus tests took 6m03s on the run that produced the figures above, because
every transaction goes through a real committee. The five marked `slow` additionally call
real models and took 6m59s. Two of them skip, legitimately: the committee judged those
proposals non-compliant, which is a valid outcome rather than a failure. So 11 of the 13
pass and 2 skip, and none of the skips hides a defect.

For the reader:

```bash
npm ci                                  # an npm workspace: install from the root
npm run typecheck --workspace frontend
npm run build --workspace frontend
python check_bundle_guard.py
python check_layout.py
```

**Direct mode is not GenVM.** It runs the contract's Python in-process with web and LLM
calls mocked. It is fast enough to iterate against and it is where the 117 tests live,
but a passing direct suite is necessary and never sufficient: the equivalence
principles only mean anything under a real committee, which is what the consensus suite
is for.

---

## What this does not fix

The list that matters more than the guarantees above, because anything a contract can
enforce is already in the source.

- **That the committee is right.** A validator committee re-derives each decision from
  the charter, but it is still a model judging prose. The reader shows its stated
  reasons so you can disagree with them. It cannot show you the reasons are sound.
- **That the trust is plural.** One member holds every share. One approval satisfies
  quorum. The contract removes the operator's ability to manufacture that
  arrangement; it cannot create pluralism.
- **That the code you are reading is the code that is deployed.** The reader checks
  that the constitution and state views agree, which catches a substituted contract. It
  is a consistency check, not an attestation. For that, deploy the contract yourself and
  keep the address.
- **That a good outcome follows from a correct one.** Conservation means the money is
  accounted for. It does not mean it was spent well. A trust can reconcile perfectly and
  fund something you think is a bad idea.
- **That anyone has reviewed this.** Every test here was written by the person who wrote
  the contract. Nobody independent has read it. A test suite can be wrong, and 117 of
  them agreeing proves only that they agree.

The full statement of limits is at [`/about`](frontend/src/app/about/page.tsx), and
[`SECURITY.md`](SECURITY.md) separates what the contract enforces without trust in the
operator from what no contract here can enforce for you.

The record of what was wrong and what closed it is
[FINDINGS.md](FINDINGS.md).

---

## Licence

MIT. See [LICENSE](LICENSE).