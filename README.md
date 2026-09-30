# Fideicommis

An autonomous trust on [GenLayer](https://docs.genlayer.com): an estate that is
**entrusted in perpetuity**, administered under its own written charter, judged
by a committee of AI validators, and administered by nobody but its own rules.
It funds whoever keeps it alive, sleeps when it runs out, and revives when it is
funded again.

This is the implementation of the *Unstoppable Organizations* use case in the
official [GenLayer ideas table](https://docs.genlayer.com/developers/intelligent-contracts/ideas):
*"Create autonomous entities like DAOs that can adapt and continue their
missions indefinitely as long as they remain funded, including AI DAOs and
autonomous trusts."*

## If you are reviewing this, read these five things

| | | |
| --- | --- | --- |
| **What it does** | [What a fideicommis is](#what-a-fideicommis-is) · [The lifecycle](#the-lifecycle) | and explicitly [what it is not](#what-this-is-and-what-it-is-not) |
| **What is verified, on a real network** | [Verified on real GenVM](#verified-on-real-genvm) | every claim below is a real Studionet transaction |
| **What it does not do** | [What this does not fix](#what-this-does-not-fix) · [Known limits](#known-limits) | read this before believing the rest |
| **What I got wrong and fixed** | [Findings](#findings) | six of them, each with the hole and the guard that now closes it |
| **How to run it** | [Quick check for a reviewer](#quick-check-for-a-reviewer) | no network and no model calls, about ten seconds |

The honest summary is that the money path was sound and the *guardrails around
the guardrails* were not. An operator could take the whole estate in four calls
without a single vote. That is fixed, and
[the sequence is now walked step by step and refused by name](#the-operator-could-take-the-whole-estate-in-four-calls).

## Findings

The six defects below are the substance of this submission, so they are grouped
here rather than scattered. Each says what was wrong, why it mattered, and what
changed. The honest version of a review is the record of what you got wrong.

| # | Defect | Where |
| --- | --- | --- |
| 1 | The operator could take the whole estate in four calls | [details](#the-operator-could-take-the-whole-estate-in-four-calls) |
| 2 | Model prose could become the constitution | [details](#model-prose-can-no-longer-become-the-constitution) |
| 3 | A receipt could belong to a different transaction | [details](#a-receipt-can-be-for-the-wrong-transaction) |
| 4 | The money was not accounted for, only counted | [details](#every-attogen-is-accounted-for) |
| 5 | A charter could deadlock its own amendment | [details](#a-charter-can-deadlock-its-own-amendment) |
| 6 | The factory could not deploy anything at all | [details](#the-factory-could-not-create-anything) |

Two more, which are about the tooling rather than the contract: a driver drove a
hardcoded number of cycles and so never reached `DORMANT`
([below](#the-funding-loop-drained-to-nothing-and-revived)), and the audit
reader fired sixteen calls at once and was throttled into looking broken
([below](#read-the-record-instead-of-trusting-this-document)).

The GenLayer team's review of an earlier version is answered point by point in
[what the review actually said](#what-the-genlayer-review-actually-said). Most of
it addressed other submissions; three items were real and are fixed.


## What a fideicommis is

A *fideicommis* (Latin *fidei commissum*, "by faith entrusted") is a legal
structure with four defining properties, and this project is built so that all
four are enforced by the chain rather than by trust:

| Legal property | What it means | What enforces it here |
| --- | --- | --- |
| **Entrusted, not owned** | The property is held for beneficiaries, and the founder's intent binds the trustee | the charter, which the founders cannot edit directly |
| **Irrevocable** | Once established it cannot be wound up by the person who created it | changing the charter needs the same assessment and vote as any other act |
| **Held for a purpose** | There is a stated reason for the trust, and the trustee must act toward it | the mission and the rulebook derived from the charter |
| **Administered by a fiduciary** | The trustee owes a duty to the beneficiaries, not to itself | the autonomous cycle, which pays grantees and nobody else |

The common-law equivalent is a charitable trust or a permanent endowment, and
the reason for the name is that it is exact rather than decorative: everything
this project does is a property of a fideicommis, and nothing it does is a
property of a DAO.

## What this is, and what it is not

It is **not a DAO**, and calling it one would be a lie. The live fideicommis that
has been paying out has one beneficiary holding 100% of the votes, and in every
disbursement the proposer, the only voter and the recipient were the same
address. That is an autocrat with a compliance officer.

What it *is* is the stronger claim: **a constitution with a treasury**. The entity
proposes, judges, pays, reviews the work, settles the remainder, and amends its
own charter, and every one of those steps is re-derived independently by a
committee of validators before it becomes immutable on-chain. The capabilities
that make that real are all verified on a real network:

1. **It acts by itself.** `advance_cycle` is called by anyone, and the committee
   chooses the action. It funded a grant and settled a delivery with no one
   telling it to, both times paying a non-member.
2. **It cannot be argued out of its charter.** Money moves only when the
   committee independently re-judges the proposal against the rulebook and
   agrees. A surveillance grant was offered to the live entity and it was
   refused, with the reasoning on-chain.
3. **It can change that charter.** But only by going through its own process,
   which is the part that had to be designed carefully.
4. **Its operator cannot take the estate.** Quorum, the spend ceiling, the
   membership, the rulebook and the evidence sources are constitutional: not
   operator-settable, bounded by hard constants, and any change to them needs a
   member vote plus an hour of public notice. The four-call capture this contract
   used to allow is walked step by step, and refused by name, in
   [finding 1](#the-operator-could-take-the-whole-estate-in-four-calls).

Claim 4 is narrower than claims 1 to 3 on purpose. It says the operator cannot
take the estate and cannot do it by arranging for a rule change first. It does
**not** say a one-member trust is well governed; that is
[What this does not fix](#what-this-does-not-fix), and it is the most important
sentence in this document.

## The problem this design solves

An Intelligent Contract cannot start a transaction by itself. There is no cron,
no keeper, no scheduler on GenLayer. Any design that claims to "run forever" has
to answer one question: **who pays for the transaction that keeps it alive?**

Here the fideicommis answers it itself:

1. `advance_cycle()` is **permissionless** — any address may call it.
2. It is **rate limited on-chain** by `next_tick_at`, which only ever moves
   forward, so it can be neither spammed nor rushed by the operator.
3. When it runs, the fideicommis **pays the caller** `keeper_reward` out of its
   own estate, alongside the per-cycle `burn_per_cycle`.

So the trust subsidises its own administration. Anyone willing to press the
button is compensated for it, and the loop can only stop when the estate does.
That is the "unstoppable" part, and it is an
[`emit_transfer`](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers)
to the caller, not a promise in a document.

Runway is on-chain arithmetic, not an off-chain claim: `treasury / burn_per_cycle`.
When it reaches zero the fideicommis enters `DORMANT` and stops acting. Any
`fund()` revives it — permanently funded, permanently resumable.

## Layout

```
contracts/
  fideicommis.py              the trust itself: charter, treasury, runway, autonomous cycle
  fideicommis_factory.py      provisions the template, registers the trusts it creates
  storage_semantics.py  fixture contract that pins GenVM storage behaviour
scripts/
  studionet.cjs                  shared Studionet driver: pacing, execution checks, deploy, write
  run_mission_loop.cjs           funding, burn, keeper reimbursement, dormancy, revival
  run_proposal_flow.cjs         rejection path, then the full money path
  run_factory_check.cjs         template provisioning, trust creation, cross-contract calls
web/                           the audit reader: Next.js, read-only, holds no key
  run_fideicommis.cjs         the three core claims: acts by itself, pays a non member, amends itself
tests/
  test_fideicommis.py         direct-mode tests, millisecond feedback
  test_fideicommis_factory.py factory guards, template provisioning, access control
  test_no_float.py                invariant: no float division, no float in consensus
  test_storage_semantics.py       regression tests for the storage rules we rely on
  integration/
    test_consensus.py       the same flows through a real validator committee
```

## Quick check for a reviewer

```bash
pip install -e ".[dev]"
python -m pytest -v
for f in scripts/*.cjs; do node --check "$f"; done

# the reader
cd web && npm ci && npm run build && npx tsc --noEmit
```

Expect `133 passed, 10 skipped`. The skips are the integration tests, which skip
themselves when no GenLayer node is reachable. `tests/test_no_float.py` is the
file to read first if the review is about VM stability.

Those skipped tests are a real caveat and worth being honest about: they are the
only place the timelock and the removed operator powers are exercised through a
genuine validator committee rather than in-process. Writing them found a stale
assertion that direct mode could not, because nothing in `tests/` calls
`set_evidence_urls` any more. **A skipped test is not a passing test**, and the
read-only view additions below exist partly to make the live path checkable
without a node at all.

## What is consensus-critical, and what is not

GenLayer only earns its keep where a decision cannot be reduced to code. The
boundary is deliberate:

| Layer | Owns |
| --- | --- |
| `Fideicommis` | the four judgments below, plus the state transitions and money movement that follow from them |
| GenLayer validators | independently re-deriving each judgment from the same charter and evidence |
| Caller / frontend | funding, submitting proposals, voting, calling `advance_cycle`, indexing and display |
| External sources | the raw facts in `evidence_urls`; the contract treats them as untrusted input |

The contract never asks "does this JSON look well formed?" and calls that
consensus. Every equivalence rule re-runs the whole task and compares the
substantive decision.

### The four equivalence rules

| Method | Leader produces | Validators independently compare |
| --- | --- | --- |
| `bootstrap_rules()` | a numbered rulebook extracted from the charter | `rule_count` within ±1, at least 3 rules, at least one mandatory. The stored text is the leader's; only its size is verified |
| `assess_proposal()` | `verdict` ∈ `COMPLIANT` / `NON_COMPLIANT` / `UNDETERMINED` | re-judges the same proposal against the same rulebook, then requires **exact** agreement on `verdict` and on whether any rule was broken, plus confidence within one 20-point bucket |
| `review_delivery()` | `verdict` and a 0–100 `score` | re-reads the public evidence and requires **exact** agreement on `verdict`, a hard floor at `score >= 50` for `ACCEPTED`, and `score` within one 20-point bucket |
| `advance_cycle()` | `action` ∈ `SETTLE` / `FUND` / `ADAPT` / `HOLD` / `WIND_DOWN` | re-derives the action and requires **exact** agreement, that any amount is within the on-chain spend ceiling, and confidence within one bucket |

Free text (`rationale`, `violations`) is stored but never compared — two
validators legitimately word things differently. Payouts are **derived
deterministically** from the score (`amount * score // 100`) so the money that
moves never depends on a number a model produced twice.

And when the model *does* get to move money, the guard is not the model's:
`FUND` pays only if the proposal it named is genuinely `COMPLIANT`, unexecuted,
unsettled and past quorum, and `SETTLE` pays only for a delivery the committee
already `ACCEPTED`. A wrong or invented `proposal_id` degrades the cycle to
`HOLD` and says so in the log. Both paths ran on Studionet and both paid a
non-member.

### Why the leader cannot cheat

`advance_cycle()` is where an autonomous agent could plausibly try to drain a
treasury, so the LLM output is treated as a *proposal*, not an instruction:

- `FUND` and `SETTLE` are only applied if the named proposal is genuinely
  `COMPLIANT`, unexecuted, and carries enough member share. A wrong or invented
  `proposal_id` degrades the cycle to `HOLD` and is logged.
- Amounts are capped twice: inside the leader's parsing logic, and again in
  deterministic code against `spend_ceiling_atto = treasury * spend_ceiling_bps / 10000`.
- Budget, quorum, funding and recipient are validated on-chain. The model never
  chooses a number that is trusted as-is.
- If the leader's own run raises, validators re-run it: matching `[EXPECTED]` and
  `[EXTERNAL]` failures must match exactly, two `[TRANSIENT]` failures agree,
  and any `[LLM_ERROR]` forces disagreement so the leader rotates. A validator
  that cannot produce its own answer never accepts (`_verify` returns `False`).

## The lifecycle

```
            fund()
              |
   ACTIVE <---+---> DORMANT            (treasury exhausted, loop halts)
      |  |           |
      |  |           +--- fund() ---> ACTIVE        (resumes, no new deployment)
      |  |
      |  +--- execute_proposal(CHARTER_AMENDMENT) ---> charter v+1, rulebook cleared
      |
      +--- advance_cycle() -> WINDING_DOWN -> dissolve() -> DISSOLVED
              (operator may also wind down or dissolve directly)
```

A charter amendment is the adaptation path, and it is deliberately *not* a
shortcut: the model drafts the new charter, but the draft becomes a normal
proposal that must be assessed against the current charter, reach quorum, and be
executed like any other. Adapting the rules is as expensive as acting under
them.

## Install and test

```bash
pip install -r requirements.txt

# static checks
genvm-lint check contracts/fideicommis.py
genvm-lint check contracts/fideicommis_factory.py

# 133 tests, no network, no model calls, ~12 seconds
python -m pytest -v

# the VM stability invariant on its own
python -m pytest tests/test_no_float.py -v
```

Direct mode is the fast loop: `gl.nondet.web` and `gl.nondet.exec_prompt` are
mocked with regex patterns, and `direct_vm.run_validator()` re-runs each
captured validator function with **different** mocks, so the equivalence rules
are exercised for real, not assumed. The suite asserts both agreement
(`run_validator() is True`) and disagreement (`is False`) for every rule —
including the cases that must reject: a different verdict, an out-of-policy
amount, unparsable model output, and an unreachable evidence source.

## Running on a network

Studionet is the fastest real target: hosted, gasless, no Docker.

```bash
npm install -g genlayer
genlayer network set studionet
genlayer account list
genlayer account use <your-account>
```

Deploy. Note that **PowerShell drops a trailing empty argument**, so never pass
`""` as the last `--args` value — an empty `evidence_urls` arrives as a missing
argument and the constructor fails with a confusing
`missing 1 required positional argument`:

```bash
genlayer deploy --contract contracts/fideicommis.py `
  --args "Climate Fund" `
         "Permanently fund verifiable open source climate adaptation research." `
         "<charter text>" `
         "0xYourOperatorAddress" `
         "https://example.org/impact"
```

Read the stderr whenever a deploy does not succeed, because `ACCEPTED` and
`FINALIZED` do not mean the code ran:

```bash
genlayer receipt <txHash> --stdout --stderr
```

Then drive the loop:

```bash
genlayer call  <trust>     get_status
genlayer write <trust>     bootstrap_rules
genlayer call  <trust>     get_charter_rules
genlayer write <trust>     fund --value 10
genlayer write <trust>     set_policy --args "1000000000000000" "0" "3600"

# evidence sources are constitutional now, so they are set at deploy time
# or through a GOVERNANCE proposal, not by the operator
genlayer write <trust>     submit_proposal --args "<title>" "<scope>" "GRANT" "500000000000000000" "0xGrantee"
genlayer write <trust>     assess_proposal --args "p1"
genlayer write <trust>     cast_vote       --args "p1" true
genlayer write <trust>     execute_proposal --args "p1"
genlayer write <trust>     advance_cycle   # permissionless, pays the caller
genlayer call  <trust>     get_org_summary
genlayer call  <trust>     get_mission_log --args 0 50
genlayer appeal <txHash>                  # challenge a settled decision
```

A recommended order is: deploy (evidence sources are a constructor argument),
`bootstrap_rules`, fund, `set_policy`, then open the loop. `assess_proposal`
refuses to run until the rulebook exists, which keeps the first consensus call
explicit rather than burying an LLM call inside every deploy.

There is no `set_evidence_urls`, `set_member_shares` or `clear_rules` to call
here, and that is deliberate: all three are constitutional and go through a
`GOVERNANCE` proposal. Two views make the constitution checkable rather than
asserted, and they are separate on purpose:

| View | Returns | Can a vote change it |
| --- | --- | --- |
| `get_constitution` | the hard limits, the delay, the constitutional kinds | no |
| `get_constitutional_state` | current quorum, ceiling, shares, charter version | yes |

Verified on a live trust, where a vote had already moved the state:

```
get_constitution        : {"amendment_delay": 3600, "constitutional_kinds": [...],
                            "governance_fields": [...], "max_spend_ceiling_bps": 5000,
                            "min_quorum_bps": 2500}
get_constitutional_state: {"quorum_bps": 5000, "spend_ceiling_bps": 2000, ...}
```

## Integration tests

`tests/integration` runs the same flows through a validator committee. It needs
a reachable node and skips itself with instructions when there is none.

```bash
GENLAYER_RPC=http://127.0.0.1:4000/api gltest tests/integration -v -s --contracts-dir contracts --network localnet
```

Notes on this target:

- `gltest` resolves contract paths against `--contracts-dir`. Do not add a
  `networks:` block to `gltest.config.yaml` - with `genlayer-test` 0.29.2 a
  partial override crashes the preconfigured-network lookup, and the `default`
  key shown in the docs is not a valid key in that version.
- Against **Studionet this suite cannot run**: the Python SDK is blocked by
  Cloudflare. Use the `genlayer` CLI there, as shown above.
- `glsim` (`pip install genlayer-test[sim]`) is **not** usable with this suite at
  the moment: it fails to register deployed contracts for schema reads, and a
  second deployment of identical contract code inside the same process raises
  `class is not marked for usage within storage`. Use GenLayer Studio
  (`genlayer up`, needs Docker) instead.
- Mock validators and `genvm_datetime` are **localnet only**:
  `simulate_write_contract` in `genlayer-py` rejects any other chain, so on a
  hosted network neither the LLM output nor the transaction timestamp can be
  pinned. Budget for real calls and real rate limits.
- Fee-charging networks need a measured profile first: `gltest tests/integration
  --fee-profile --contracts-dir contracts`.

## No floats anywhere in consensus

GenVM emulates floats in software, so rounding behaviour is not something a
consensus rule may depend on, and a true-division `/` turns an integer
calculation into a float one that can crash the VM or make a leader and its
validators disagree on identical input.

Both contracts contain **zero** `/` operators. Every division is integer
division, and the complete inventory is eight sites, all of them audited:

| Site | Expression | Denominator |
| --- | --- | --- |
| `_confidence_bucket` | `confidence // 20` | constant |
| `review_delivery` validator | `int(theirs["score"]) // 20` | constant |
| `review_delivery` validator | `int(mine["score"]) // 20` | constant |
| `review_delivery` settlement | `budget * score // 100` | constant |
| `advance_cycle` validator | `int(mine["amount_atto"]) * 12 // 10` | constant |
| `_spend_ceiling_atto` | `int(self.treasury) * int(self.spend_ceiling_bps) // 10000` | constant |
| `_runway_cycles` | `int(self.treasury) // burn` | guarded by `if burn <= 0` |
| `_quorum_met` | `approved_shares * 10000 // total` | guarded by `if total <= 0` |

There is no `_avg` function; the averaging roles it would play are the spend
ceiling and the runway, both integer.

Floats are also kept out of the **decision data**, not just the arithmetic. A
model may answer `"80.7"` or `"88.4"`, and those used to reach the contract as
Python floats through `float()` and `round()`. Now:

- `json.loads(..., parse_float=_truncate_decimal)` truncates decimals to integers
  as the response is parsed.
- `_scrub_floats` walks an already-decoded dict, because the SDK returns one
  directly when `response_format="json"` is used and the hook never runs.
- `_pick_int` parses integers with digit-scanning string operations only, with
  no float coercion and no rounding.

`_truncate_decimal` and `_parse_int_text` are the only places the word `float`
appears, and only as an `isinstance` type guard — the code that *removes* floats
rather than creating them.

`tests/test_no_float.py` enforces all of this as a permanent invariant: no
`ast.Div` in any contract, no float literal, no `float()` call, `float` allowed
only inside a type guard, the division inventory pinned exactly, and the two
variable denominators asserted to be guarded. A reviewer can run
`python -m pytest tests/test_no_float.py -v` and audit the whole surface in one
command.

## Choosing a test tool

Studionet is hosted Studio, so you never download Docker or run Studio locally.
What you do need to know is which tool can actually *reach* it.

| Tool | Reaches Studionet | Docker | Mocks LLM/web | Pins time | Use it for |
| --- | --- | --- | --- | --- | --- |
| direct mode (`genlayer-test`) | n/a, no network | no | yes | yes | logic, storage semantics, validator agreement |
| `genlayer` CLI (Node.js) | **yes** | no | no | no | real end-to-end deployment and inspection |
| `gltest --network studionet` | **no, blocked** | no | no | no | unusable against Studionet as installed |
| `glsim` (local) | n/a | no | yes | yes | local network, but broken in 0.29.2 |
| GenLayer Studio local | n/a | yes | yes | yes | full GenVM parity when you have Docker |

**Studionet sits behind Cloudflare and rejects non-browser User-Agents.** This
was measured, not guessed:

```
User-Agent: Python-urllib/3.12                     -> HTTP 403  (Cloudflare 1010)
User-Agent: genlayer-py/0.16.3                    -> HTTP 502
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64)   -> HTTP 200  {"result":"0xf22f"}
```

`genlayer-py` 0.16.3 (and therefore `gltest`) sends the second kind of header,
so **every** Python-SDK call to Studionet is refused. The Node.js CLI gets
through, which makes it the only automated route to Studionet today. If you
need pytest against Studionet, front it with a proxy that rewrites the
User-Agent, or wait for an SDK release that sets a browser UA.

Studionet limits to plan around: **30 JSON-RPC requests per minute** per IP
(rejects with `-32029` and a `retry_after_seconds` hint); 32 in-flight
transactions per sender (`-32028`); gasless, so no fee is needed but a value
transfer still requires a balance.

## Verified on real GenVM

The claims that make this an autonomous trust, on Studionet, with real model calls
and a real validator committee. Grants here pay a **non-member** beneficiary, so
the money genuinely leaves the trust.

```
trust      : 0x50590E26DB529954633b1e8e887d5f9501c0C4DF
beneficiary: 0xb94e5cb14acfaabd03aa69f599a30a3799c773af   (not a member)
policy     : burn 0, keeper 0, tick 60s, ceiling 20 percent

[1-4] deploy, bootstrap_rules (5 rules), fund 0.400000, set_policy
[6]  assess_proposal p1  -> COMPLIANT  confidence 95
[8]  advance_cycle       -> action=FUND     treasury 0.400000 -> 0.380000
     {"memo": "autonomous_fund:p1",   "to": "0xB94E...739AF"}
[9]  review_delivery     -> ACCEPTED  score 100
[10] advance_cycle       -> action=SETTLE   treasury 0.380000 -> 0.360000
     {"memo": "autonomous_settle:p1", "to": "0xB94E...739AF"}
[11] charter amendment   -> COMPLIANT, vote, execute
     charter rewritten  version 1 -> 2
     new rule present   ok
     rulebook cleared   ok
```

Nobody told it to do any of that. `advance_cycle` was called by a keeper, and
the committee chose FUND and then SETTLE.

Also verified live, on earlier trusts: the funding loop with per-cycle
burn and keeper reimbursement, dormancy when the treasury empties, revival by
`fund()`, the rejection path where a surveillance grant is blocked from voting
and payment, the full grant and settlement path driven by hand, and the entire
factory path.

### The funding loop, drained to nothing and revived

Driven on Studionet with real LLM validators by `scripts/run_mission_loop.cjs`.
No Docker, no local Studio.

```
trust  : 0x0FDb65E153FBb58321C4FF6E0B3C9a7FD88747aF
keeper : 0x53fF83418988F57F0E4fA9c23A3852e081dE21D1
policy : fund 0.3 GEN, burn 0.1 GEN/cycle, keeper 0.0005 GEN/cycle, tick 60s

[2] fund() with value  -> treasury 0.859000 GEN
[3] set_policy()       -> runway 8 cycles
    driving 9 cycles: runway_cycles=8, plus the one that finds the floor

[4.1] advance_cycle()  cycle=7   treasury=0.758500  runway=7  keepers=5   paid=0.002500
[4.2] advance_cycle()  cycle=8   treasury=0.658000  runway=6  keepers=6   paid=0.003000
[4.3] advance_cycle()  cycle=9   treasury=0.557500  runway=5  keepers=7   paid=0.003500
[4.4] advance_cycle()  cycle=10  treasury=0.457000  runway=4  keepers=8   paid=0.004000
[4.5] advance_cycle()  cycle=11  treasury=0.356500  runway=3  keepers=9   paid=0.004500
[4.6] advance_cycle()  cycle=12  treasury=0.256000  runway=2  keepers=10  paid=0.005000
[4.7] advance_cycle()  cycle=13  treasury=0.155500  runway=1  keepers=11  paid=0.005500
[4.8] advance_cycle()  cycle=14  treasury=0.055000  runway=0  keepers=12  paid=0.006000
[4.9] advance_cycle()  cycle=15  treasury=0.000000  status=DORMANT

[5] advance_cycle()    correctly rejected: "[EXPECTED] fideicommis is DORMANT, not ACTIVE"
[6] fund() again       status=ACTIVE  treasury=0.300000  runway=3  -> revived
```

Two things in that log are the point of the design.

`cycle=14` still shows `runway=0` while `status=ACTIVE`: the estate had 0.055 GEN,
which is below one `burn`, so it cannot fund another cycle but has not been
marked dormant yet. Only `cycle=15` finds the floor. That is why the driver
takes its cycle count from the on-chain runway instead of hardcoding one — an
earlier version drove a fixed 3 cycles, never reached `DORMANT`, and its own
rejection check passed for the wrong reason.

And the keeper line climbs the whole way down: 12 distinct callers, 0.006 GEN
reimbursed, paid out of the estate that was being spent. Nobody had to be
nominated to keep it running.

Each cycle cost exactly `burn + keeper_reward`, and the caller of
`advance_cycle` was reimbursed from the estate every time. That is the
"unstoppable" mechanism working on a real network, not a claim in a document.

Running them yourself:

```bash
# 1. give the keeper some GEN (Studionet is gasless but transfers need a balance)
genlayer account send <keeper> 0.5gen

# 2. put the keeper key where the drivers expect it, then pick a run
cp <exported-keeper-key> scripts/orgkeeper.key
node scripts/run_mission_loop.cjs --deploy
node scripts/run_proposal_flow.cjs
node scripts/run_factory_check.cjs
node scripts/run_fideicommis.cjs --new
```

Everything Studionet-specific lives in `scripts/studionet.cjs` rather than being
repeated per script, because each of these was learned the hard way:

- **A transaction can reach ACCEPTED and FINALIZED and still have rolled back.**
  `set_policy` failing on-chain looked identical to success until the driver
  started reading `consensus_data.leader_receipt[0].result.payload`. Always check
  `execution_result` and `result.status === "return"`.
- **30 JSON-RPC requests per minute, 500 per hour**, rejected with `-32029` and a
  `retry_after_seconds` hint. Every call is paced and backs off on the hint.
- **Reads retry.** A child deployed `on="finalized"` is not readable until the
  parent finalizes, so `not found` and `execution failed` are treated as
  transient rather than fatal.

### The loop found a real design bug

On the first live run the model chose `WIND_DOWN` on the cycle that drained the
treasury. `WIND_DOWN` was applied before the exhaustion check, so the
`DORMANT` branch was skipped and the fideicommis was left `WINDING_DOWN` with
no way back — funding it did not revive it. That contradicts the entire premise.

Fixed by making exhaustion take precedence: winding down exists to distribute a
remainder, so a fideicommis that just ran out of money has nothing to wind
down and sleeps instead. `fund()` now also refuses money once a fideicommis is
`WINDING_DOWN` or `DISSOLVED`, otherwise a late donation would be collectable
by the operator through `dissolve()`. Both rules are covered by
`test_exhausted_treasury_sleeps_even_if_the_model_wants_to_wind_down` and
`test_a_winding_down_fideicommis_refuses_new_funds`, and the live log now
shows `dormant` then `revived`.

### The judge has teeth, and it can explain itself

Two proposals were put to a live fideicommis on Studionet. The first, a
country-scale facial-recognition surveillance network:

```
assess_proposal p1  ->  NON_COMPLIANT   violations=["R1","R4"]
cast_vote        ->  blocked: "[EXPECTED] cannot vote on a non compliant proposal"
execute_proposal ->  blocked: "[EXPECTED] proposal p1 is not compliant"
treasury         ->  unchanged
```

`get_proposal_audit` then returned the model's own reasoning for a *second*
attempt, and it is worth reading in full because it shows what the equivalence
rule is really doing:

> "R3 requires that every grant be used to keep a specific public web page
> reachable, and the charter's mission is to maintain climate-adaptation
> reference material. The named URL https://example.org/ is explicitly a
> placeholder domain used for documentation examples (as confirmed by the
> external evidence), and its content contains no climate-adaptation reference
> material whatsoever."

The validator fetched the page, recognised it as a documentation placeholder, and
refused to treat it as evidence. That rejection is correct, and it is also the
clearest demonstration that the compliance judge is reading evidence rather than
pattern-matching on the proposal text.

`get_proposal_audit` exists because of this. A trust that spends money has to be
able to show why it decided what it did, and the original
contract only stored the verdict. It now exposes the verdict, the violated rule
identifiers, the reasoning and the confidence, plus the delivery review's own
reasoning. The compact `get_proposal` is unchanged, because that one feeds the
`advance_cycle` prompt and is deliberately bounded.

### The money path, end to end

A second trust was deployed on Studionet with a charter its fixture
deliverable genuinely satisfies, so nothing about the verdict was staged:

```
trust  : 0xaEDf11fD920Fc8C06EB6754387072C97D0e468aF   (Open Reference Fund)

[B1] bootstrap_rules   -> 8 rules extracted, committee agreed
[B2] fund()            -> treasury 0.300000 GEN
[B4] submit_proposal   -> p1
[B5] assess_proposal   -> COMPLIANT  confidence 97  violations []
[B6] cast_vote + execute_proposal  -> treasury 0.300000 -> 0.280000
[B7] review_delivery   -> ACCEPTED  score 100  payout 0.020000   (real fetch)
[B8] settle_delivery   -> treasury 0.280000 -> 0.260000
[B9] advance_cycle     -> HOLD, correctly, the grant was already done

lifetime flow: inflow 0.300000  outflow 0.040000
keeper balance moved by exactly 0.040000
```

The mission log holds the whole trail, both payouts included:

```
{"event": "proposal_assessed", "id": "p1", "verdict": "COMPLIANT", "violations": 0}
{"amount_atto": "20000000000000000", "event": "payout", "memo": "grant:p1"}
{"event": "delivery_reviewed", "id": "p1", "payout_atto": "20000000000000000", "score": "100"}
{"amount_atto": "20000000000000000", "event": "payout", "memo": "settlement:p1"}
```

The assessment that let this through also exposed a second prompt defect. The
charter's first rule is "no single grant may exceed 10 percent of the treasury",
and the judge rejected a perfectly valid grant with:

> "R1 ... cannot be evaluated because the treasury balance is not provided"

The contract was passing only the spend *ceiling* to the assessment prompt. A
rule expressed as a share of a balance is unjudgeable without the balance, so
the prompt now states the current treasury, the request, and the request as a
percentage. The successful verdict cites it directly: *"the requested amount is
6% of the treasury, below the 10% limit."* Covered by
`test_assessment_prompt_carries_the_treasury_balance` and
`test_assessment_prompt_states_the_request_as_a_share_of_the_treasury`.

The three live runs are worth summarising, because in all three the judge's
verdict was right and the *fixture* was what needed changing:

| Attempt | Fixture | Verdict | Who was wrong |
| --- | --- | --- | --- |
| 1 | surveillance grant, climate charter | `NON_COMPLIANT` R1, R4 | nobody |
| 2 | grant for `example.org` | `NON_COMPLIANT` R2, R3 | the fixture, a placeholder is not evidence |
| 3 | same, treasury facts added to the prompt | `NON_COMPLIANT` R1, R2, R3 | the contract, for withholding the balance |
| 4 | grant for a real climate-adaptation page | `COMPLIANT` 97% | nobody |

## A receipt can be for the wrong transaction

The Studionet drivers wait for a transaction, then read
`consensus_data.leader_receipt[0].result.payload` to find out whether the leader
actually returned. That part was correct. What was missing: **nothing checked
that the receipt belonged to the hash that was just submitted.**

A receipt that happens to be an earlier transaction looks exactly like a
successful one. The driver would read it, see a clean `execution_result=SUCCESS`,
and attribute some previous intent's outcome to the call under test — which is
the worst possible failure mode for a verification script, because it reports
success. Both `writeTo` and `deployContract` now compare the receipt's own hash
against the submitted one and refuse on mismatch:

```
[EXPECTED] receipt is for another transaction: 0xdead... != 0xbeef...
```

The comparison accepts the several names a node uses for the field and is
case-insensitive; if a node echoes no hash at all the receipt is still accepted,
because a missing field is not evidence of a mismatch. Six cases are covered,
including a deliberate mismatch.

## Model prose can no longer become the constitution

The `ADAPT` action let the autonomous cycle write the model's own `rationale`
straight into a charter-amendment proposal body. That is a real hole, and the
sequence is short:

1. `advance_cycle` returns `ADAPT` with the leader's `rationale`.
2. Validators agree on the **action** — `compare()` checks `action`, `amount_atto`
   and bucketed confidence. It never checked that text.
3. So two validators can agree on `ADAPT` while describing entirely different
   charters, and the prose neither of them validated is the prose that becomes
   the body.
4. If that body reaches quorum and executes, it is installed as the constitution.

The reasoning field is still unvalidated, which is the general problem, but it no
longer has anywhere consequential to go. The suggestion is logged as an advisory
`adaptation_suggested` entry for a human to read, the proposal body starts empty,
and `execute_proposal` refuses any amendment with no charter text at all:

```
[EXPECTED] amendment p4 carries no charter text, a member must author it
```

Verified on Studionet against a live trust, where the empty amendment was
submitted, assessed `COMPLIANT`, and given an approving vote — and still could
not change the charter:

```
submit empty amendment -> ok
assess                  -> ok   verdict=COMPLIANT  body_len=0
cast_vote               -> ok   approvals=1
execute_proposal        -> refused: "carries no charter text, a member must author it"
charter_version         -> 2 -> 2   (unchanged)
```

The member-authored path is unaffected and still works; `test_a_member_authored_
amendment_still_works` pins both halves so a fix here cannot quietly close the
amendment door.

## Every attoGEN is accounted for

The contract reported `lifetime_inflow`, `lifetime_outflow` and `keeper_paid`
without ever stating the identity those three should satisfy, so "the money is
accounted for" was a claim rather than a check. Each payout now declares which
bucket it belongs to, and `get_lifetime_flow` reports the buckets so the sum can
be compared against the treasury:

```
inflow == treasury + granted + settled + dissolved + keeper_paid + burned
```

`burned` is derived as `outflow - granted - settled - dissolved`, so it is
arithmetic on the other counters rather than a second thing to keep in sync. The
bucket is an explicit argument to `_pay`, and `_pay` validates it **before** any
value moves, so a future payout path cannot debit the treasury and then fail its
way out of the identity. Five tests cover it: grants, settlement, burn and keeper
rewards together, dissolution, and the rejection of an unbucketed payout.

On the live trust after a full cycle:

```
inflow       0.400000
granted      0.020000
settled      0.019000
treasury     0.361000
buckets + treasury = 0.400000 = inflow      CONSERVED
```

## What the GenLayer review actually said

A reviewer's notes on this project, and what each one turned out to be. Most of
the criticism was addressed to other submissions — escrow, prediction markets,
insurance, honeypots — and does not have a counterpart here. The three that did
are fixed above.

| Criticism | Status here |
| --- | --- |
| "replace float divisions `/` with `//` in `_avg` and approval logic" | No `/` exists. `test_no_float.py` inventories every division and fails on a float one. |
| "repin the dependency to a resolvable version" | Pinned to `py-genlayer:1jb45aa8yn…`; the factory rejects a template without that header. |
| "correlate each result to the transaction just submitted" | **Real.** Fixed: the receipt hash is now verified. |
| "validators only check that reasoning mentions an evidence ID; that unchecked reasoning steers the outcome" | **Real.** Model prose can no longer reach the charter. |
| "bind the exact payout percentage in the settlement nondeterministic path" | Already bound: `compare()` agrees on the score in 20-wide buckets and `payout = (budget * score) // 100` derives from it. |
| "add a withdrawal so platform fees are not locked" | There is no fee mechanism, so nothing can be locked. |
| "settled milestones can be paid or refunded again" | `settled` is checked on all four payout paths. |
| "evidence URLs are passed without fetching their contents" | Fetched contract-side: `_fetch_source` calls `gl.nondet.web.get` and the response body goes into the prompt. |
| "add the fund-conservation tests claimed in the README" | The README made no such claim and no such test existed. Both are now true: the claim, and the tests. |
| escrow, disputes, challenge expiry, prediction markets, honeypots, identity-hash poisoning | Not part of this design. |

## The operator could take the whole estate in four calls

This was the worst hole in the project, and no test caught it because every test
checked that a guard *existed*, not that the guards were connected.

The money path was genuinely autonomous — `advance_cycle` needed nobody's
permission and the committee re-judged every proposal. But the guardrails around
those guardrails were all `_require_operator()`, and a capture was four calls:

```python
set_member_shares(operator, 10000)   # 1. be the only member
set_policy(0, 0, 3600, 1, 10000)     # 2. quorum 0.01%, ceiling 100%
submit_proposal(..., CHARTER_AMENDMENT, 0, "")
cast_vote(id, True); execute_proposal(id)
```

Step 2 was the load-bearing one, and it existed because quorum and the spend
ceiling were parameters of `set_policy`. Once one member owned everything, one
vote was a quorum, and step 4 was a formality.

What made it worse: the rule the committee *derived from the charter itself*
read *"the existing rules in this charter do not by themselves constrain such a
proposal."* So R1, the 10% cap, did not protect the amendment. Clear the
rulebook, re-derive it from the new charter, and the ceiling the operator had
raised is 100%.

## What closed it

Quorum and the spend ceiling are no longer policy. They are constitutional:
fixed at genesis, and reachable only through a `GOVERNANCE` proposal that needs a
member vote and then sits approved for an hour before it can execute.

```python
set_policy(burn, keeper_reward, tick_interval)   # operational only
submit_proposal(title, "QUORUM_BPS:8000", "GOVERNANCE", 0, "")   # constitutional
```

The other three operator powers are gone entirely. `set_member_shares`,
`clear_rules` and `set_evidence_urls` each refuse and name the proposal kind that
replaces them. The methods stay so the refusal is explicit rather than a confusing
"unknown method" at call time:

```
membership  -> refused: "...submit a GOVERNANCE proposal with MEMBER_SHARES:MEMBER:SHARES instead"
rulebook    -> refused: "...submit a GOVERNANCE proposal with CHARTER_RULES:clear instead"
evidence    -> refused: "...submit a GOVERNANCE proposal with EVIDENCE_URLS:<urls> instead"
```

A governance body is a strict `FIELD:VALUE` instruction, never prose, and every
value is re-validated in the contract rather than trusted from the proposal. The
vote authorises an *intent*; the contract decides whether that intent is legal.

`wind_down` and `dissolve` deliberately stay operator powers, and that is an
argument rather than an oversight: winding down can only *start*, and the
remainder only reaches the operator once the treasury is already at zero. The
operator still cannot fund themselves from a live trust.

### The hard limits are not policy

`MIN_QUORUM_BPS = 2500` and `MAX_SPEND_CEILING_BPS = 5000` are constants. A vote
can tighten the trust and never loosen it past those. Verified on Studionet with
a fully-approved, timelocked proposal to raise the ceiling to 100%:

```
submit "SPEND_CEILING_BPS:10000" -> ok
assess                          -> COMPLIANT
cast_vote                       -> ok, quorum met
execute (immediately)            -> refused: "p2 is timelocked for 3568s more"
execute (after the delay)       -> refused: "spend ceiling must be within 1..5000"

ceiling 2000  (unchanged)   quorum 5000  (unchanged)
```

The committee had also independently assessed it `NON_COMPLIANT` against the rule
it had derived, which is the second line of defence working as intended.

### The timelock, on the real network

The same live trust, with a genuine member-authored amendment:

```
execute p2, right after quorum  -> refused: "p2 is timelocked for 3568s more"
                                   charter_version still 1
... 1 hour and a vote later ...
execute p2                      -> EXECUTED
                                   charter_version 2
                                   rulebook cleared, history 1, new rule present
```

The delay is stamped when quorum is *reached*, not when the proposal was
submitted, so a proposal that sat unvoted for a month does not execute instantly
once approved. It is stamped only on the first approving vote, so a later vote
cannot restart the clock. Grants are not timelocked at all: money cannot wait, or
the trust would be unable to pay anyone for an hour after every approval, which
is a liveness failure dressed up as safety.

### The full sequence, as one test

`test_the_original_capture_sequence_is_now_impossible` walks all four steps
against a live trust and asserts the constitution is byte-identical afterwards.
`test_a_vote_cannot_loosen_the_constitution_past_its_limits`,
`test_a_constitutional_change_waits_out_the_timelock`,
`test_a_grant_is_never_timelocked` and
`test_governance_cannot_vote_itself_into_existence` cover the rest.

## What this does not fix

The live trust still has one member with 100% of the shares, and a single member
who votes on their own proposal is still a single member. Nothing here creates
pluralism; it removes the operator's ability to *manufacture* it unilaterally. The
honest version of the fourth claim is narrower than the first three:

> The operator cannot take the estate unilaterally, and cannot do it by
> arranging for a rule change first. But a one-member trust is governed by one
> person, and this contract cannot change that.

Pluralism is a social fact, not a contract invariant. What the contract can do is
make sure that one person cannot convert "I am the only member" into "I own the
treasury" in four transactions, and cannot do it faster than an hour of public
notice.

## Read the record instead of trusting this document

Every claim above can be checked against the contract's own view methods. There is
a reader for that, and it signs nothing.

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

```
web/src/app/                 App Router: landing, /trust/[address], /api/health
web/src/lib/genlayer.ts      the chain client: paced, keyless, read-only
web/src/lib/trust.ts         one pass over a trust, degraded rather than broken
web/src/components/          conservation, gauges, decision chain, panels
```

Next.js 16, React 19, TypeScript strict with `noUncheckedIndexedAccess`. It holds
**no private key**: the chain client is built with no account, because reads do
not need one, and `server-only` on that module turns importing it from a client
component into a build error rather than a review comment. CI asserts both, and
greps the built client chunks for chain code.

The reason it is a full-stack framework rather than a static page: the browser
cannot reach the GenLayer node (CORS), and the node allows 30 reads a minute, so
something server-side has to do the calling and the pacing. Doing it in the
framework removes the separate relay process, and `force-dynamic` means a reader
never sees a record baked into a build.

It shows, per proposal: the chain (proposed → judged → voted → funded → reviewed →
settled), the committee's own reasoning for the verdict and for the delivery, and
the text that was actually voted on. Two things are diagrams rather than claims:

- **Conservation.** The six buckets as a row of figures that must total the
  inflow. If it does not balance, the rule turns vermilion and the page says how
  much is unaccounted for.
- **The constitutional gauges.** Quorum and the ceiling as positions between a
  hard stop and a hard stop, so "you cannot vote yourself past this" is a position
  you can see.

It cross-checks `get_constitution` against `get_constitutional_state` and refuses
to present the figures if the deployed bytecode disagrees with itself.

Three honest limits, all stated in the interface rather than hidden:

- **It cannot show how much of a timelock remains.** The contract records when
  quorum was reached but does not expose that timestamp as a view. The page says
  so and points at `get_proposal_audit` plus the block time of the vote.
- **Quorum feasibility is inferred, not read.** Where a single member holds at
  least the quorum share, one approval was sufficient; where that does not hold it
  says nothing rather than guessing.
- **A read that fails is shown as empty, not guessed.** A trust that has not
  derived its rulebook yet is a normal state, so the page degrades per call and
  names which one failed rather than refusing to render.

### A reader that reported itself broken

The first version of the static reader fired sixteen view calls at once. That
looks efficient and it is exactly what got it throttled: the limiter answers the
overflow with an **HTML page**, which no JSON client can parse, so a busy node
presented as a broken trust. It reads one call at a time now, the queue is
serialised so two readers cannot outrun the limit, and when the node does answer
with a page the reader says so in words.

The same class of bug appeared in the Next version: an address with no contract
behind it threw a raw SDK error and produced a 500, where the honest answer is a
404 that explains what a Fideicommis answers. Both the not-found page and the
error boundary are now written for the two ways this actually fails, rather than
for the one that is easy to imagine.

## A charter can deadlock its own amendment

The most interesting failure found in this project, and it is a design trap
rather than a bug.

The charter said *"changing any of these rules requires the same approval process
as an ordinary grant"*. That is exactly how most people write it, and it is
unambiguous to a human. The validator committee read it as requiring the
**amendment** to satisfy the grant's substantive rules too, and rejected it:

> "R5 requires any rule change to undergo the exact same approval process as an
> ordinary grant (which must satisfy R1-R4 and name a specific public URL); this
> CHARTER_AMENDMENT proposal bypasses that process entirely."

The reasoning is sound given the wording, and the effect is fatal: an
fideicommis that cannot amend its charter is not adaptive, it is frozen. The
contract was the only place that knows what the approval process *is*, so it now
says so, for amendment proposals only:

> THIS PROPOSAL REWRITES THE CHARTER ITSELF. Assess it against the charter
> currently in force, not against the charter it proposes. A rule such as
> "changing any of these rules requires the same approval process as an ordinary
> grant" constrains the PROCESS, not the substance […] it does not mean the
> amendment must itself satisfy the substantive requirements that apply to grants.

After that, the same trust rewrote its own charter from version 1 to version 2,
added a rule, and had its rulebook cleared for re-derivation under the new terms.

The lesson generalises: **if your constitution is natural language, something
has to define its own procedural terms.** An autonomous trust that can be
locked out of changing itself is a trust with a constitution it can no longer
amend, and the deadlock is silent: it just looks like a trust that never
proposes anything.

Note what the *fix* is not: the amendment still had to be assessed, voted on and
reach quorum. Only the ambiguity that made the committee judge the amendment
against a charter that did not exist yet was removed. And the one path that
would have skipped all of that — the autonomous `ADAPT` writing the model's own
prose into the body — is now closed; see
[the section above](#model-prose-can-no-longer-become-the-constitution).

## The factory could not create anything

`fideicommis_factory.py` was written the way the docs' factory example reads its
template: `open("/contract/fideicommis.py")`. Deployed for real on Studionet it fails
every time:

```
[EXPECTED] organization source not found at /contract/fideicommis.py
```

A single-file deployment carries no sibling files into the sandbox, so the path
does not exist. The factory was unusable and had zero tests.

The template is now **provisioned through calldata** instead:

```python
provision_template(code)   # deployer only, once, then frozen
deploy_org(name, mission, charter, evidence_urls, operator)
```

`provision_template` rejects an empty string, anything without
`class Fideicommis(gl.Contract)`, and anything without a pinned `Depends`
header, and it refuses a second call so a live factory's children all come from
the same immutable code. Verified on Studionet:

```
deploy_org before provisioning  -> refused: "no template provisioned"
provision_template(63235 bytes) -> provisioned
provision twice                -> refused: "already provisioned and this factory is frozen"
deploy_org x N                 -> 7 registered children, all template_bytes 63235
cross-contract view            -> status ACTIVE, full summary read from the child
poke                           -> advance_cycle accepted on the child
```

Two operational details that cost real debugging time:

- **The registry fills before the child exists.** `deploy_org` writes the
  registry in the parent transaction, but `gl.deploy_contract(on="finalized")`
  deploys the child in a follow-up transaction. Reading the child immediately
  after `deploy_org` returns "Contract not found". Callers must wait, so the
  driver retries reads.
- **A child of the factory has the factory as founder**, so the factory is its
  only member and nobody else can vote. `cast_vote` fails with "sender is not a
  member" until a `GOVERNANCE` proposal adds the intended members — which now
  costs a vote and the timelock rather than one operator call. The factory cannot
  know the intended membership at deploy time, so this is a deliberate extra
  step, and it is the kind of thing a real deployment guide has to say out loud.
  A freshly created trust is therefore single-member until someone proposes its
  membership, which is exactly the state
  [What this does not fix](#what-this-does-not-fix) is about.

Storing 63 KB of source in factory storage is a real cost. It is a one-time
write per factory and the trade is worth it here, but a production version would
want the template in a content-addressed store and pass only a hash.

### The tick cooldown only moves forward

Discovered on Studionet when a policy change appeared not to take effect:
lowering `tick_interval` does **not** pull `next_tick_at` backwards. That is
deliberate, and it is the property that keeps the on-chain cooldown a real
bound on how fast the treasury can drain, rather than something the operator can
switch off. It is pinned by
`test_shortening_the_cooldown_never_pulls_the_deadline_back`.

## Direct mode is not GenVM

`Address("0x...")` works everywhere, but on a real node the calldata decoder
hands address arguments over as `Address` objects, and `Address(Address)` raises
`TypeError: cannot convert 'Address' object to bytes` → `exit_code 1`.

The constructor took an `operator: str` and wrapped it unconditionally. Direct
mode and Studio pass a string, so 98 tests were green while every real
deployment crashed. `_to_address()` now accepts either form, and it is used at
all four call sites that wrap calldata.

The general lesson: direct mode proves logic, only a real network proves the
contract runs. Treat a green direct-mode suite as necessary, never sufficient.

## Storage rules this contract depends on

GenLayer persists Python objects by pickling, so storage shape is part of the
contract's ABI. `tests/test_storage_semantics.py` pins three behaviours that
`genlayer-test` 0.29 exposes, each of which silently corrupts proposal
bookkeeping if a runner upgrade changes it:

- `TreeMap[str, DynArray[str]]` accepts a plain Python list on assignment
  (`self.violations[pid] = [...]`) and supports `.append()` afterwards.
- A missing key is **absent**, not empty: `key in self.map` before iterating,
  `.get(key, default)` before reading.
- `gl.storage.inmem_allocate(DynArray[str])` raises; it needs an explicit empty
  list, `gl.storage.inmem_allocate(DynArray[str], [])`.

`Proposal` therefore holds only scalars, and the variable-length parts live in
contract-level `TreeMap[str, DynArray[str]]` fields.

Two further rules apply to the main contract:

- **Storage layout is positional.** The contract is upgradable through
  `gl.storage.Root`, so new fields may only be **appended**. Reordering or
  inserting a field shifts every slot after it and corrupts deployed state.
- **The runner hash is pinned** in the `Depends` header. `py-genlayer:test`,
  `:latest` and unversioned pins are rejected by every GenLayer network.

## Known limits

- `mission_log` stops appending at 500 entries and sets `log_truncated`. The log
  is an audit aid, not the system of record; state lives in the typed fields.
- `advance_cycle()` scans at most the 20 most recent proposals when building its
  prompt, to bound transaction cost.
- `_proposal_dashboard` and `_quorum_met` are O(n) in proposals and members.
  Fine for a founding-sized trust, not for thousands of proposals.
- Every path in this README has been executed on Studionet, including the two
  guards that decide whether a model may cause money to leave
  (`_action_fund`, `_action_settle`) and the charter amendment.
- What is *not* demonstrated is pluralism. The live trust has one member, so
  quorum and voting are structurally correct and socially empty. Nothing here
  shows a community of people who do not trust each other governing a treasury.
  That is the gap between this and a real DAO, and it is a gap in participation,
  not in the contract.
- One operator holds the keys. A production deployment would put the operator
  behind a multisig and add a proposal deposit so spam proposals cost something.
- The contract is a synthetic jurisdiction, not a legal one. Nothing here
  replaces the agreements, licensing, or jurisdiction a real trust would need,
  and the appeal path exists precisely so a disputed outcome can be challenged
  by validators rather than settled by one model.
