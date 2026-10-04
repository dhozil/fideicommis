/**
 * The read budget, asserted against the code rather than against a comment.
 *
 * `MAX_PROPOSALS` in `trust.ts` is derived from two numbers: how many fixed views a
 * render costs, and the node's per-minute limit. Both used to live only as a comment
 * explaining the arithmetic, which is how `FIXED_READS` stayed at 10 through a commit
 * that added six more fixed views: the comment still read "fixed reads 10", so nothing
 * contradicted it and nothing failed.
 *
 * So this reads the source and counts. A prose claim about a number is checked against
 * the number, which is the only way the two can be made to disagree loudly.
 *
 * Run: npx tsx@4 tests/check_read_budget.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "frontend", "src", "lib", "trust.ts"), "utf-8");

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

function constant(name: string): number {
  const match = source.match(new RegExp(`const ${name} = (-?[\\d_]+)`));
  if (!match?.[1]) throw new Error(`${name} is not a numeric constant in trust.ts`);
  return Number(match[1].replace(/_/g, ""));
}

console.log("=== the fixed reads constant matches the views actually sent ===");
{
  // The batched read, counted from the array literal rather than from the comment.
  const batch = source.match(/const FIXED: \{ method: string; args\?: unknown\[\] \}\[\] = \[([\s\S]*?)\n  \];/);
  if (!batch?.[1]) throw new Error("the FIXED read list was not found in trust.ts");
  const methods = [...batch[1].matchAll(/method: "([a-z_]+)"/g)].map((m) => m[1]);
  const declared = constant("FIXED_READS");

  check("the array literal was found", methods.length > 0, `${methods.length} methods`);
  check(
    `FIXED_READS is ${declared}, and ${methods.length} fixed views are sent`,
    declared === methods.length,
    declared === methods.length ? methods.join(" ") : `sent: ${methods.join(" ")}`,
  );
  check("no method is listed twice", new Set(methods).size === methods.length);
}

console.log();
console.log("=== the proposal cap fits inside the node's per-minute budget ===");
{
  const limit = constant("NODE_CALLS_PER_MINUTE");
  const slack = constant("SLACK_CALLS");
  const fixed = constant("FIXED_READS");
  const perProposal = constant("CALLS_PER_PROPOSAL");

  const derived = Math.floor((limit - slack - fixed) / perProposal);
  // MAX_PROPOSALS is itself derived rather than written as a literal, which is correct —
  // a hand-typed cap is exactly what drifts from its inputs. So it is recomputed here from
  // the same inputs and compared, rather than read.
  const maxLine = source.match(/const MAX_PROPOSALS = ([^;]+);/);
  if (!maxLine?.[1]) throw new Error("MAX_PROPOSALS was not found in trust.ts");
  const maxProposals = Math.floor(
    Function(
      "NODE_CALLS_PER_MINUTE",
      "SLACK_CALLS",
      "FIXED_READS",
      "CALLS_PER_PROPOSAL",
      `return ${maxLine[1].replace(/Math\./g, "Math.")};`,
    )(limit, slack, fixed, perProposal) as number,
  );
  check("MAX_PROPOSALS is what the arithmetic gives", maxProposals === derived, `${derived}`);
  check("there is room left for slack", limit - slack - fixed - maxProposals * perProposal >= 0);

  const worstCase = fixed + maxProposals * perProposal;
  check(
    `a full render costs ${worstCase} of ${limit} calls a minute`,
    worstCase <= limit,
    `${worstCase} <= ${limit}`,
  );
  // One more proposal than the cap allows would exceed the budget with no slack left,
  // which is the failure the cap exists to prevent. Asserted so raising either constant
  // past the point of safety fails here rather than on the node.
  check(
    "one more proposal would breach the budget",
    fixed + (maxProposals + 1) * perProposal > limit - slack,
    `${fixed + (maxProposals + 1) * perProposal} > ${limit - slack}`,
  );
}

console.log();
console.log("=== every view the reader sends takes the arguments it requires ===");
{
  // get_mission_log(offset, limit) is the only one of these that takes arguments, and
  // it was called with none. That is not an empty log: the node answers "Missing or
  // invalid parameters", the reader treats a failed view as degraded, and the panel shows
  // an empty list as though the trust had no history. Found by scripts/audit_new_views.cjs,
  // not by the type checker, because the arguments are untyped at this boundary.
  check(
    "get_mission_log is called with an offset and a limit",
    /method: "get_mission_log", args: \[0, MISSION_LOG_LIMIT\]/.test(source),
  );
  check("the limit is a named constant", /const MISSION_LOG_LIMIT = \d+;/.test(source));
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "the read budget is what the comment says it is");
if (failed) process.exit(1);