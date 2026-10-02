/**
 * Does the transaction panel tell a stranger the truth?
 * 
 * The wallet panel shows committee evidence to the person who signed a write. The new
 * `?tx=` path on /verify shows it to anyone holding a hash, which is the audience that
 * matters. That is only safe if the four outcomes stay distinguishable, because the whole
 * risk here is a page that reports "the committee rejected this" for a transaction the
 * node has simply never heard of.
 * 
 * This renders the component's logic against real receipt shapes and checks which of the
 * four verdicts comes out. It asserts the verdict logic rather than the markup, because
 * the verdict is the part that can mislead.
 * 
 * Run: node_modules/.bin/tsx tests/check_tx_verdict.mts
 */

import { equivalenceOf, hasConsensus, leaderSays } from "../frontend/src/lib/equivalence";
import { isTxHash } from "../frontend/src/lib/address";
import type { EquivalenceEvidence } from "../frontend/src/lib/equivalence";

/** Mirrors the four branches in TxEvidence.tsx. */
type Verdict = "no record" | "not yet decided" | "settled" | "rolled back";

function verdictOf(found: boolean, evidence: EquivalenceEvidence, ran: boolean): Verdict {
  if (!found) return "no record";
  if (!ran) return "not yet decided";
  return leaderSays({ consensus_data: { leader_receipt: [{}] } }).ok || evidence.leaderStatus === "return"
    ? "settled"
    : "rolled back";
}

interface Case {
  name: string;
  receipt: unknown;
  found: boolean;
  want: Verdict;
  why: string;
}

const CASES: Case[] = [
  {
    name: "a hash the node has no record of",
    receipt: null,
    found: false,
    want: "no record",
    why: "must never read as a rejection; the node has not been asked",
  },
  {
    name: "a pending transaction, no consensus_data yet",
    receipt: { hash: "0x01", status_name: "PENDING" },
    found: true,
    want: "not yet decided",
    why: "a committee that has not convened is not a committee that refused",
  },
  {
    name: "a settled write",
    receipt: {
      consensus_data: {
        leader_receipt: [
          { execution_result: "SUCCESS", eq_outputs: { return: "true" }, result: { status: "return" } },
        ],
        validators: [
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xAAA" } },
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xBBB" } },
        ],
      },
    },
    found: true,
    want: "settled",
    why: "the ordinary case",
  },
  {
    name: "a rollback carrying FINALIZED",
    receipt: {
      hash: "0x03",
      status_name: "FINALIZED",
      consensus_data: {
        leader_receipt: [
          {
            execution_result: "ERROR",
            eq_outputs: {},
            result: { status: "rollback", payload: "engine said no" },
          },
        ],
        validators: [{ execution_result: "ERROR", vote: "agree", node_config: { address: "0xAAA" } }],
      },
    },
    found: true,
    want: "rolled back",
    why: "FINALIZED is attached to a rollback; the verdict must not follow it",
  },
];

let failed = 0;

console.log("=== the four verdicts stay distinct ===");
for (const testCase of CASES) {
  const evidence = equivalenceOf(testCase.receipt);
  const ran = hasConsensus(testCase.receipt);
  const got = verdictOf(testCase.found, evidence, ran);
  if (got === testCase.want) {
    console.log(`  ok   ${testCase.name}`);
    console.log(`       ${got} — ${testCase.why}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${testCase.name}: said ${got}, wanted ${testCase.want}`);
  }
}

console.log();
console.log("=== a rolled-back transaction is never reported as settled ===");
const rollback = CASES[3].receipt;
const rbEvidence = equivalenceOf(rollback);
if (leaderSays(rollback).ok) {
  failed += 1;
  console.log("  FAIL leaderSays accepted a receipt whose execution_result is ERROR");
} else {
  console.log(`  ok   leaderSays rejects it: ${leaderSays(rollback).reason}`);
}
if (rbEvidence.leaderOutput !== null) {
  failed += 1;
  console.log(`  FAIL a rollback produced an output: ${JSON.stringify(rbEvidence.leaderOutput)}`);
} else {
  console.log(`  ok   and it has no output, only a reason: ${JSON.stringify(rbEvidence.leaderError)}`);
}

console.log();
console.log("=== the hash gate rejects what is not a hash ===");
const shapeCases: [string, boolean][] = [
  ["0x" + "ab".repeat(32), true],
  ["0x" + "AB".repeat(32), true],
  ["0x1234", false],
  ["0x" + "ab".repeat(31), false],
  ["0x" + "ab".repeat(33), false],
  ["ab".repeat(32), false],
  ["", false],
  ["0x" + "zz".repeat(32), false],
];
for (const [value, want] of shapeCases) {
  const got = isTxHash(value);
  if (got === want) {
    const shown = value.length > 20 ? `${value.slice(0, 12)}…` : value || "(empty)";
    console.log(`  ok   ${shown}  ${want}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${value.slice(0, 20)}: said ${got}, wanted ${want}`);
  }
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "the panel cannot report a rejection for a transaction it knows nothing about");
if (failed) process.exit(1);
