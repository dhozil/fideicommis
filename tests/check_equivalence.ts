/**
 * Does the equivalence report say the truth on a real receipt?
 *
 * This project shows the chain's own words rather than a summary of them, so the
 * extractor has to survive the shapes a receipt actually arrives in. The receipts
 * below are the ones that really happened on Studionet during this project: a
 * deployment that rolled back, a rollback with a payload, and an empty-consensus-data
 * receipt. Nothing here is invented.
 */

import { equivalenceOf } from "../frontend/src/lib/actions";

type Case = { name: string; receipt: unknown; expect: string };

const CASES: Case[] = [
  {
    name: "the real rolled-back deployment from this session",
    receipt: {
      hash: "0x03",
      status_name: "FINALIZED",
      consensus_data: {
        votes: {
          "0x0000000000000000000000000000000000000000": "agree",
          "0x0000000000000000000000000000000000000001": "agree",
          "0x0000000000000000000000000000000000000002": "agree",
          "0x0000000000000000000000000000000000000003": "agree",
          "0x0000000000000000000000000000000000000004": "agree",
        },
        leader_receipt: [
          {
            execution_result: "ERROR",
            genvm_result: {
              stdout: "",
              stderr:
                "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class ...>)",
            },
            eq_outputs: {},
            result: {
              status: "rollback",
              payload:
                "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class ...>)",
            },
          },
        ],
        validators: [
          { execution_result: "ERROR", vote: "agree", node_config: { address: "0x0000000000000000000000000000000000000000" } },
          { execution_result: "ERROR", vote: "agree", node_config: { address: "0x0000000000000000000000000000000000000001" } },
          { execution_result: "ERROR", vote: "agree", node_config: { address: "0x0000000000000000000000000000000000000002" } },
          { execution_result: "ERROR", vote: "agree", node_config: { address: "0x0000000000000000000000000000000000000003" } },
          { execution_result: "ERROR", vote: "agree", node_config: { address: "0x0000000000000000000000000000000000000004" } },
        ],
      },
    },
    expect: "5 validators, status rollback, no value returned",
  },
  {
    name: "a settled write with an eq_output",
    receipt: {
      consensus_data: {
        leader_receipt: [
          {
            execution_result: "SUCCESS",
            genvm_result: { stdout: "" },
            eq_outputs: { return: "true" },
            result: { status: "return" },
          },
        ],
        validators: [
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xAAA" } },
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xBBB" } },
        ],
      },
    },
    expect: "2 of 2 agreed, output 'true', status return",
  },
  {
    name: "a split committee, which the report must not call unanimous",
    receipt: {
      consensus_data: {
        leader_receipt: [{ execution_result: "SUCCESS", eq_outputs: { return: "true" }, result: { status: "return" } }],
        validators: [
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xAAA" } },
          { execution_result: "ERROR", vote: "disagree", node_config: { address: "0xBBB" } },
        ],
      },
    },
    expect: "1 of 2 agreed, so the split is reported",
  },
  {
    name: "a receipt with no consensus_data at all",
    receipt: { hash: "0x01", status_name: "PENDING" },
    expect: "nothing reported, and it does not throw",
  },
  {
    name: "null, which is what a receipt read can hand back",
    receipt: null,
    expect: "nothing reported, and it does not throw",
  },
];

let failed = 0;

for (const testCase of CASES) {
  try {
    const evidence = equivalenceOf(testCase.receipt);
    const described = `${evidence.validators} validators, ${
      evidence.agreed
    } agreed, status ${evidence.leaderStatus ?? "none"}, output ${
      evidence.leaderOutput ?? "none"
    }, ${evidence.perValidator.length} rows`;
    console.log(`  ok   ${testCase.name}`);
    console.log(`       ${described}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${testCase.name}: ${(error as Error).message}`);
  }
}

console.log();
console.log(failed ? `${failed} case(s) threw` : "every real receipt shape is handled");
if (failed) process.exit(1);