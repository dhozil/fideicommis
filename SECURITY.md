# Security

## Do not commit keys

This repository talks to a public testnet. A key committed here is a key
published, and there is no second line of defence.

`.gitignore` covers `*.key`, `.env` and `scripts/*.address`, but a `.gitignore` is
a safety net and not a lock. Before every commit:

```bash
git diff --cached --name-only | grep -E '\.(key|env)$|\.address$' && echo "STOP: secret staged"
```

The drivers read a keeper key from `scripts/orgkeeper.key` (or from the path in
`FIDE_KEY_FILE`). It is a real account on Studionet with a balance, because a
value transfer needs one even on a gasless network. It is not in this repository
and must never be.

## What the contract protects, and what it does not

Being explicit about this is a security property, not a disclaimer.

**Enforced on-chain, without trust in the operator:**

- Spend is capped by a ceiling a vote can tighten but never raise past 50% of the
  treasury, and quorum can never fall below 25% of shares.
- A grant needs a committee verdict, member votes, and quorum.
- An already executed or settled proposal cannot be paid twice; the `settled` and
  `executed` flags are checked on all four payout paths.
- Every payout is attributed to exactly one conservation bucket, and `_pay`
  refuses a bucket it does not recognise, so value cannot leave the estate
  unaccounted for.
- Membership, the rulebook, the evidence sources, quorum and the ceiling are not
  operator-settable. They move only through a `GOVERNANCE` proposal, which needs
  a member vote and then waits out the delay.
- Model prose never becomes charter text. `ADAPT` records the model's suggestion
  as an advisory log note; the amendment body starts empty and an empty amendment
  cannot execute.

**Outside the contract.** The project boundaries — one member per live trust, one
author, testnet, unreviewed — are stated once, on the reader's `/about` page,
rather than repeated here. What matters for this file: the contract removes the
operator's ability to manufacture sole membership unilaterally; it cannot create
pluralism, prove a committee's reasoning correct, or keep a public node answering.

## Reporting a problem

Open an issue describing the input, the address, and the observed behaviour
against `consensus_data.leader_receipt`. A report that includes the leader
receipt is worth ten that do not, because a transaction can reach `ACCEPTED` and
`FINALIZED` and still have rolled back.
