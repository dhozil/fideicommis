#!/usr/bin/env node
/**
 * Factory check on Studionet: can a registered factory really deploy a child?
 *
 * An earlier factory read the child source from a path inside the sandbox and
 * failed on every deployment, because a single-file deployment carries no
 * sibling files. The template is now provisioned through calldata instead, and
 * this script proves that path works: the guard rails, the frozen template, the
 * registry, the cross-contract reads, and the poke message to the child.
 *
 * Setup, once:
 *   genlayer account send <keeper> 0.5gen
 *   and put the keeper key at scripts/orgkeeper.key (gitignored)
 *
 * Usage:  node scripts/run_factory_check.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver } = require("./studionet.cjs");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const client = makeClient(path.join(HERE, process.env.FIDE_KEY_FILE || "orgkeeper.key"));
const { readFrom, writeTo, deployContract, balance } = makeDriver(client);

const FACTORY_FILE = path.join(HERE, "factory.address");

const CHARTER = [
  "This fideicommis maintains a public archive of climate-adaptation reference material.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: every grant must be to keep a public web page reachable, and the grant body must name the exact public URL to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: changing any of these rules requires the same approval process as an ordinary grant.",
].join(" ");

const MISSIONS = [
  ["Coastal Trust", "Keep coastal flood defences maintained for the villages that need them."],
  ["Alpine Water Fund", "Keep the alpine snowpack monitoring network publicly reported."],
];

async function main() {
  const factoryCode = fs.readFileSync(path.join(ROOT, "contracts", "fideicommis_factory.py"), "utf-8");
  const orgCode = fs.readFileSync(path.join(ROOT, "contracts", "fideicommis.py"), "utf-8");

  console.log(`keeper   : ${client.account.address}`);
  console.log(`balance  : ${(Number(await balance()) / 1e18).toFixed(6)} GEN`);
  console.log(`template : ${orgCode.length} bytes of Fideicommis source\n`);

  let factory = fs.existsSync(FACTORY_FILE) ? fs.readFileSync(FACTORY_FILE, "utf-8").trim() : "";
  if (!factory) {
    console.log("[1] deploy the factory");
    const d = await deployContract(factoryCode, []);
    if (!d.ok) {
      console.log(`  FAILED at ${d.phase}: ${d.reason}`);
      return;
    }
    console.log(`  ${d.hash}\n  factory ${d.address}`);
    factory = d.address;
    fs.writeFileSync(FACTORY_FILE, factory, "utf-8");
  } else {
    console.log(`factory  : ${factory} (reusing)`);
  }

  const read = (m, args = []) => readFrom(factory, m, args);
  const write = (m, args = []) => writeTo(factory, m, args);

  console.log(`  template status: ${await read("get_template_status")}`);

  if (Number(JSON.parse(await read("get_template_status")).bytes) === 0) {
    console.log("\n[2] deploy_org without a template must be refused");
    const early = await write("deploy_org", [...MISSIONS[0], CHARTER, "", client.account.address]);
    console.log(`  ${early.ok ? "ACCEPTED (BAD)" : `refused: ${early.reason.slice(0, 120)}`}`);

    console.log("\n[3] provision_template with the real Fideicommis source");
    const p = await write("provision_template", [orgCode]);
    if (!p.ok) {
      console.log(`  FAILED at ${p.phase}: ${p.reason}`);
      return;
    }
    console.log(`  ${p.hash}`);
    console.log(`  template status: ${await read("get_template_status")}`);

    console.log("\n[4] provisioning twice must be refused");
    const twice = await write("provision_template", [orgCode]);
    console.log(`  ${twice.ok ? "ACCEPTED (BAD)" : `refused: ${twice.reason.slice(0, 120)}`}`);
  } else {
    console.log("  template already provisioned, skipping [2] to [4]");
  }

  const before = Number(await read("get_org_count"));
  const tag = `Probe ${String(Date.now()).slice(-6)}`;
  console.log(`\n[5] deploy_org ${tag}`);
  const r = await write("deploy_org", [tag, MISSIONS[0][1], CHARTER, "", client.account.address]);
  if (!r.ok) {
    console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    return;
  }
  console.log(`  ${r.hash}`);

  console.log("\n[6] the registry fills immediately, the child exists a moment later");
  const after = Number(await read("get_org_count"));
  console.log(`  org_count ${before} -> ${after}`);
  console.log(`  org_names  ${await read("get_org_names")}`);
  console.log(`  registry   ${await read("get_registry")}`);

  const address = await read("get_org_address", [tag]);
  console.log(`\n[7] cross-contract reads on the child at ${address}`);
  console.log(`  status  ${await read("get_org_status", [tag])}`);
  console.log(`  treasury ${await read("get_org_treasury", [tag])}`);
  console.log(`  summary  ${(await read("get_org_summary", [tag])).slice(0, 200)}`);

  console.log("\n[8] poke: the factory asks the child to run a cycle");
  const poke = await write("poke", [tag]);
  console.log(`  ${poke.ok ? `accepted ${poke.hash}` : `refused: ${poke.reason.slice(0, 120)}`}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
