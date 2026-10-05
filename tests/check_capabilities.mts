/**
 * A button is offered only if the deployment behind it has the method.
 *
 * Studionet cannot upgrade a contract, so a trust deployed from an earlier source is missing
 * whatever the contract gained since — `bootstrap_rules`, `assess_proposal` and
 * `set_code_upgraders` all postdate the oldest listed deployment. Offering a button for a
 * method that is not there produces a node refusal that does not name the method, so the
 * reader asks the schema instead. `lib/capabilities.ts` has the three attempts and why two
 * of them fail.
 *
 * Measured with `scripts/capabilities.cjs`: all three listed deployments carry every write,
 * so nothing is hidden from them today. That is why this check asserts the *mechanism*
 * rather than a list — the addresses it protects are the ones nobody listed, which is the
 * whole point of a reader that opens any address.
 *
 * Run: npx tsx@4 tests/check_capabilities.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "..", p), "utf-8");

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const caps = code(read("frontend/src/lib/capabilities.ts"));
const trust = code(read("frontend/src/lib/trust.ts"));
const rules = code(read("frontend/src/components/RulesActions.tsx"));
const actions = code(read("frontend/src/components/ProposalActions.tsx"));
const view = code(read("frontend/src/components/TrustRecordView.tsx"));
const types = code(read("frontend/src/lib/types.ts"));
const genlayer = code(read("frontend/src/lib/genlayer.ts"));

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

console.log("=== the probe asks the schema, because the other two ways do not work ===");
{
  // The dead ends are asserted as well as the working path, because each looks correct and
  // each would produce a confidently wrong answer rather than an error.
  check("it uses gen_getContractSchema", /gen_getContractSchema/.test(caps));
  check("over raw JSON-RPC, not the SDK", /jsonrpc/.test(caps) && /fetch\(/.test(caps));
  check("with a browser User-Agent, or Cloudflare answers 1010", /user-agent.*Mozilla|Mozilla/.test(caps));
  check("it does not use the SDK's schema call", !/\.getContractSchema\(/.test(caps));
}

console.log();
console.log("=== a failed probe removes nothing ===");
{
  // The important asymmetry. A node hiccup must not take away a working button: a reader
  // that hides a control because it could not check is worse than one that offers it and
  // reports the refusal, which WritePanel already does honestly.
  check("a failed probe is caught, not thrown", /catch/.test(caps));
  check("and reports verified: false", /verified: false/.test(caps));
  check("with nothing ruled out", /missing: \[\], verified: false/.test(caps));
  check("the panels default to offering everything", (rules.match(/missing = \[\]/g) ?? []).length === 1);
}

console.log();
console.log("=== the answer is cached, because it cannot go stale ===");
{
  check("there is a per-address cache", /new Map<string, Set<string> \| null>/.test(caps));
  check("keyed case-insensitively", /toLowerCase\(\)/.test(caps));
  // A failed probe is remembered as null so a failing node is asked once rather than on
  // every render, which matters because this runs on the request path.
  check("a failure is cached too", /cache\.set\(key, names\)/.test(caps));
}

console.log();
console.log("=== every write the reader offers is in the list ===");
{
  const declared = caps.match(/READER_WRITES = \[([\s\S]*?)\] as const/);
  check("the list was found", declared?.[1] !== undefined);
  const listed = [...(declared?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  for (const method of [
    "fund",
    "set_policy",
    "set_code_upgraders",
    "bootstrap_rules",
    "submit_proposal",
    "assess_proposal",
    "cast_vote",
    "execute_proposal",
    "review_delivery",
    "advance_cycle",
  ]) {
    check(`${method} is probed`, listed.includes(method));
  }
  check("no method is listed twice", new Set(listed).size === listed.length);
}

console.log();
console.log("=== the panels honour it rather than only receiving it ===");
{
  check("RulesPanel hides the bootstrap button", /absent\.has\("bootstrap_rules"\)/.test(rules));
  check("RulesPanel hides the policy button", /absent\.has\("set_policy"\)/.test(rules));
  check("RulesPanel hides the upgraders button", /absent\.has\("set_code_upgraders"\)/.test(rules));
  check("ProposalActions hides the assess button", /absent\.has\("assess_proposal"\)/.test(actions));
  check("the record carries the list to the panels", /missing=\{record\.missingWrites\}/.test(view));
  check("the record type declares it", /missingWrites: string\[\]/.test(types));
  check("and whether it was a fact or an assumption", /capabilitiesVerified: boolean/.test(types));
}

console.log();
console.log("=== the probe does not delay the figures ===");
{
  // It runs after the record is assembled, and it is a single cached call whose answer
  // cannot change. On the critical path it would put a node round trip in front of the
  // numbers, which is the mistake the render-path check exists to prevent.
  check("readTrust asks for it", /capabilitiesOf\(addr\)/.test(trust));
  check("after the record is assembled, not before", /capabilitiesOf[\s\S]*missingWrites: capabilities\.missing/.test(trust));
  check("it is not a view read, so it adds nothing to the budget", !/FIXED/.test(caps));
}

console.log();
console.log("=== reads still go through the SDK ===");
{
  // Only the schema call is hand-rolled, because only that one is broken on the node.
  check("genlayer.ts is untouched by this", !/gen_getContractSchema/.test(genlayer));
  check("and still uses the SDK client", /createClient/.test(genlayer));
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "no button is offered for a method the deployment lacks");
if (failed) process.exit(1);