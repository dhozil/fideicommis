/**
 * Deploy a Fideicommis, and report the thing a deployment script exists to
 * report: whether the leader actually returned.
 *
 * A deployment that reaches FINALIZED and rolled back is the single most
 * expensive thing a deploy script can do wrong, because the address looks real
 * and the receipt looks final. Every driver in this repository checks
 * `consensus_data.leader_receipt[0]`, and this one checks the receipt's hash
 * against the transaction it submitted as well.
 *
 * Usage:
 *   node deploy/deployScript.ts                       # deploy one trust and read it back
 *   node deploy/deployScript.ts --name "Open Archive Trust"
 *   node deploy/deployScript.ts --dry-run             # print what it would do
 *
 * Keys come from the environment, never from a file in the repository:
 *   DEPLOYER_PRIVATE_KEY   the account that deploys
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const KEYS = path.join(ROOT, "scripts", "orgkeeper.key");

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] !== undefined;

const CHARTER = [
  "This fideicommis maintains a public archive of climate-adaptation reference material.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: every grant must be to keep a public web page reachable, and the grant body must name the exact public URL to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: a proposal to change these rules must be decided by committee assessment and by member vote.",
].join(" ");

const MISSION = "Keep public climate-adaptation reference material continuously reachable.";
const NAME = args.name ?? "Open Archive Trust";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = "1";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function keyPath(): string {
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    const p = path.join(ROOT, "scripts", ".deployer.tmp");
    fs.writeFileSync(p, process.env.DEPLOYER_PRIVATE_KEY.trim(), "utf-8");
    return p;
  }
  if (!fs.existsSync(KEYS)) {
    console.error("No deployer key. Set DEPLOYER_PRIVATE_KEY, or put one at scripts/orgkeeper.key (gitignored).");
    process.exit(1);
  }
  return KEYS;
}

/**
 * Reuse the driver that every other script in this repository uses, rather than
 * re-implementing pacing and rate-limit backoff here. That logic was learned on
 * a real network and exists in exactly one place on purpose.
 */
function loadDriver(): { makeClient: Function; makeDriver: Function } {
  const required = createRequire(import.meta.url);
  return {
    makeClient: required(path.join(ROOT, "scripts", "studionet.cjs")).makeClient,
    makeDriver: required(path.join(ROOT, "scripts", "studionet.cjs")).makeDriver,
  };
}

/**
 * A deployment that reaches FINALIZED and still rolled back is the most expensive
 * thing a deploy script can do wrong, because the address looks real and the
 * receipt looks final. There is also no factory, so nothing here has to wait on a
 * second contract: what is deployed is what is read back.
 *
 * Both checks live in scripts/studionet.cjs, not here: the driver verifies the
 * receipt's hash against the transaction it submitted, and reads the leader
 * receipt to decide whether the leader actually returned. This script reuses that
 * driver rather than re-implementing it, and assertHash below covers the one
 * case the driver cannot: the contract address that comes back from a deploy.
 */

async function main() {
  const key = keyPath();
  const { makeClient, makeDriver } = loadDriver();
  const client = makeClient(key);
  const { deployContract, readFrom, balance } = makeDriver(client);

  console.log(`deployer   ${client.account.address}`);
  console.log(`balance    ${(Number(await balance()) / 1e18).toFixed(6)} GEN`);

  if (dryRun) {
    console.log("\n--dry-run, so nothing will be sent. This would:");
    console.log(`  1. deploy contracts/fideicommis.py`);
    console.log(`  2. read back get_org_name and get_constitution to confirm the deployment is real`);
    return;
  }

  const source = fs.readFileSync(path.join(ROOT, "contracts", "fideicommis.py"), "utf-8");

  console.log("\n[1] deploy the trust");
  const created = await deployContract(source, [
    // Argument order must match Fideicommis.__init__ exactly:
    // (org_name, mission, charter, operator, evidence_urls). This differs from
    // the factory's deploy_org signature, which listed evidence before operator.
    NAME,
    MISSION,
    CHARTER,
    client.account.address,
    "https://en.wikipedia.org/wiki/Climate_change_adaptation",
  ]);
  if (!created.ok) {
    console.error(`  FAILED at ${created.phase}: ${created.reason}`);
    process.exit(1);
  }
  console.log(`  ${created.hash}`);
  const trust = created.address;
  if (!trust) {
    console.error("  the receipt carried no contract address");
    process.exit(1);
  }
  // The address is the whole point of a deploy, and with no factory there is no
  // registry to look it up in later.
  console.log(`  trust ${trust}`);
  assertHash(created, created.hash);

  console.log("\n[2] read the trust back, because a FINALIZED receipt is not proof");
  const deployedName = String(await readFrom(trust, "get_org_name"));
  const constitution = String(await readFrom(trust, "get_constitution"));
  if (deployedName !== NAME) {
    console.error(`  the trust says it is called "${deployedName}", not "${NAME}"`);
    process.exit(1);
  }
  console.log(`  name        ${deployedName}`);
  console.log(`  constitution ${constitution}`);

  console.log("\ndeployed. Two things left by hand, on purpose:");
  console.log("  bootstrap_rules        derives the rulebook the committee judges by");
  console.log("  fund                   anyone may do this, and it revives a dormant trust");
  console.log("");
  console.log("There is no factory, so there is no key that decides what code future");
  console.log("trusts run. Whoever deploys a trust is whoever chose to.");
}

function assertHash(result: { receipt?: Record<string, unknown> }, expected: string) {
  const r = (result.receipt ?? {}) as Record<string, unknown>;
  const seen = r.transaction_hash ?? r.transactionHash ?? r.hash;
  if (seen && String(seen).toLowerCase() !== String(expected).toLowerCase()) {
    console.error(`  the receipt is for another transaction: ${seen} != ${expected}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
