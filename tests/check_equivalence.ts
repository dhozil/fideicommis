/**
 * Does the equivalence report say the truth on a receipt?
 * 
 * This project shows the chain's own words rather than a summary of them, so the extractor
 * has to survive the shapes a receipt arrives in. This file pins that behaviour, and it is
 * worth being precise about what it does and does not establish, because the previous
 * version of this file overstated both.
 * 
 * It used to open with "the receipts below are the ones that really happened on
 * Studionet during this project... Nothing here is invented." That was false, in two
 * ways that were both checkable:
 * 
 *   - Four of the five fixtures are visibly hand-written. Their validator addresses are
 *     `0xAAA` and `0xBBB`, and their transaction hashes are `0x01` and `0x03` — a GenLayer
 *     hash is 0x followed by 64 hex characters, so those are placeholders, not recorded
 *     hashes. There is no 64-hex string anywhere in this repository.
 *   - The one fixture with real structure — the `@allow_storage` rollback — is documented in
 *     AGENTS.md and FINDINGS.md as a defect of the **local glsim** node. Nowhere is it
 *     recorded as having happened on Studionet. Calling it a Studionet receipt contradicted
 *     the project's own findings.
 * 
 * So the honest description is this: the first fixture's *shape* came from a failure that
 * really happened, on a local node, with its identifiers redacted; the rest are
 * representatives of shapes a node can return. That is enough to pin a parser, and it is
 * not the same thing as verifying against the chain.
 * 
 * What would close the gap: a captured receipt kept on disk, checked in, with its hash in
 * the fixture so anyone can fetch it and compare. No such fixture is retained yet, which is
 * why nothing here claims to be one.
 * 
 * The second thing this file used to get wrong was quieter. Every case carried an `expect`
 * string, and the loop never compared against it — it called the extractor, printed the
 * result, and passed as long as nothing threw. A test that only proves "does not crash" was
 * named as though it proved the report was correct, which is the same error this project
 * exists to avoid, committed in the file whose job is reporting the chain honestly. The
 * expectations below are asserted, and each case states the four figures that matter.
 */

import { equivalenceOf } from "../frontend/src/lib/equivalence";
import type { EquivalenceEvidence } from "../frontend/src/lib/equivalence";

interface Case {
  name: string;
  /** Whether this shape was observed, and where. Stated per case, not once for the file. */
  origin: "observed-on-a-local-node" | "representative";
  receipt: unknown;
  /** Asserted, not decorative. */
  expect: {
    validators: number;
    agreed: number;
    leaderStatus: string | null;
    leaderOutput: string | null;
    /**
     * The engine's reason for not returning, which must be separate from a returned
     * value. This field exists because a rollback used to render its payload under a
     * heading that said "output".
     */
    leaderError: string | null;
  };
  /** What the report should therefore say, in words. */
  shown: string;
}

const CASES: Case[] = [
  {
    name: "a rollback, the shape this project hit for real on a local node",
    origin: "observed-on-a-local-node",
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
    expect: {
      validators: 5,
      agreed: 5,
      leaderStatus: "rollback",
      // Nothing came back. The payload on this one is the engine's reason, and it is
      // the whole reason these two fields are separate: reported as an output, a
      // rolled-back deploy displays a value it never produced.
      leaderOutput: null,
      leaderError:
        "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class ...>)",
    },
    shown:
      "5 validators, status rollback, no value returned. Note FINALIZED above, and note the output is null: there is nothing to show because nothing ran.",
  },
  {
    name: "a settled write carrying an eq_output",
    origin: "representative",
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
    expect: { validators: 2, agreed: 2, leaderStatus: "return", leaderOutput: "true", leaderError: null },
    shown: "2 of 2 agreed, output 'true', status return",
  },
  {
    name: "a split committee, which the report must not call unanimous",
    origin: "representative",
    receipt: {
      consensus_data: {
        leader_receipt: [{ execution_result: "SUCCESS", eq_outputs: { return: "true" }, result: { status: "return" } }],
        validators: [
          { execution_result: "SUCCESS", vote: "agree", node_config: { address: "0xAAA" } },
          { execution_result: "ERROR", vote: "disagree", node_config: { address: "0xBBB" } },
        ],
      },
    },
    expect: { validators: 2, agreed: 1, leaderStatus: "return", leaderOutput: "true", leaderError: null },
    shown: "1 of 2 agreed, so the split is reported rather than rounded up",
  },
  {
    name: "a receipt with no consensus_data at all",
    origin: "representative",
    receipt: { hash: "0x01", status_name: "PENDING" },
    expect: { validators: 0, agreed: 0, leaderStatus: null, leaderOutput: null, leaderError: null },
    shown: "nothing reported, and it does not throw",
  },
  {
    name: "null, which is what a receipt read can hand back",
    origin: "representative",
    receipt: null,
    expect: { validators: 0, agreed: 0, leaderStatus: null, leaderOutput: null, leaderError: null },
    shown: "nothing reported, and it does not throw",
  },
];

function shown(evidence: EquivalenceEvidence): string {
  return `${evidence.validators} validators, ${evidence.agreed} agreed, status ${
    evidence.leaderStatus ?? "none"
  }, output ${evidence.leaderOutput ?? "none"}${
    evidence.leaderError === null ? "" : `, reason ${JSON.stringify(evidence.leaderError)}`
  }, ${evidence.perValidator.length} rows`;
}

let failed = 0;

for (const testCase of CASES) {
  const problems: string[] = [];
  let evidence: EquivalenceEvidence;

  try {
    evidence = equivalenceOf(testCase.receipt);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${testCase.name}: threw ${(error as Error).message}`);
    continue;
  }

  const { expect: want } = testCase;
  if (evidence.validators !== want.validators) {
    problems.push(`validators ${evidence.validators}, wanted ${want.validators}`);
  }
  if (evidence.agreed !== want.agreed) {
    problems.push(`agreed ${evidence.agreed}, wanted ${want.agreed}`);
  }
  if (evidence.leaderStatus !== want.leaderStatus) {
    problems.push(`status ${JSON.stringify(evidence.leaderStatus)}, wanted ${JSON.stringify(want.leaderStatus)}`);
  }
  if (evidence.leaderOutput !== want.leaderOutput) {
    problems.push(`output ${JSON.stringify(evidence.leaderOutput)}, wanted ${JSON.stringify(want.leaderOutput)}`);
  }
  if (evidence.leaderError !== want.leaderError) {
    problems.push(`error ${JSON.stringify(evidence.leaderError)}, wanted ${JSON.stringify(want.leaderError)}`);
  }

  // An expectation is only worth writing if it can fail. Each case states a claim about
  // the four figures, and the described line is what the panel would render.
  if (problems.length) {
    failed += 1;
    console.log(`  FAIL ${testCase.name}`);
    for (const problem of problems) console.log(`       ${problem}`);
    console.log(`       got: ${shown(evidence)}`);
  } else {
    console.log(`  ok   ${testCase.name}  [${testCase.origin}]`);
    console.log(`       ${shown(evidence)}`);
    console.log(`       ${testCase.shown}`);
  }
}

console.log();
const observed = CASES.filter((c) => c.origin === "observed-on-a-local-node").length;
const representative = CASES.length - observed;
console.log(
  `${CASES.length} cases: ${observed} shape(s) observed on a local node with identifiers redacted, ` +
    `${representative} representative. No checked-in receipt from a named transaction, so this pins the ` +
    `parser's behaviour and not the chain's.`,
);
console.log(failed ? `${failed} case(s) wrong` : "every case reports exactly what it should");
if (failed) process.exit(1);