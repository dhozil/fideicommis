#!/usr/bin/env node
/**
 * Drives a fideicommis through its funding and mission loop on Studionet.
 *
 * Proves the core claim end to end with no Docker: a funded fideicommis pays
 * its per-cycle burn, reimburses whoever called advance_cycle, and falls asleep
 * when the treasury empties, then comes back to life when it is funded again.
 *
 *   fund -> set_policy -> advance_cycle xN -> DORMANT -> refused tick -> fund -> ACTIVE
 *
 * Setup, once:
 *   genlayer account send <keeper> 0.5gen
 *   and put the keeper key at scripts/orgkeeper.key (gitignored)
 *
 * Usage:
 *   node scripts/run_mission_loop.cjs              # existing scripts/trust.address
 *   node scripts/run_mission_loop.cjs --deploy     # fresh fideicommis
 *   node scripts/run_mission_loop.cjs 0x<address>  # a specific fideicommis
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, sleep, fmt } = require("./studionet.cjs");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const client = makeClient(path.join(HERE, process.env.FIDE_KEY_FILE || "orgkeeper.key"));
const { readFrom, writeTo, deployContract, balance } = makeDriver(client);

const MISSION = "Permanently fund verifiable open source climate adaptation research.";
const CHARTER = [
  "This fideicommis exists to fund open source climate adaptation research and nothing else.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: a grantee must have a public and verifiable repository before any funds are released.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: delivered work must be evidenced by a public source before a second tranche is released.",
  "Rule 5: changing any of these rules requires the same approval process as an ordinary grant.",
].join(" ");

const FUND = 30n * 10n ** 16n; // 0.3 GEN
const BURN = 10n * 10n ** 16n; // 0.1 GEN per cycle
const KEEPER = 5n * 10n ** 14n; // 0.0005 GEN per cycle
const TICK = 60;
// The number of cycles needed to drain the estate is not knowable up front: it
// depends on whatever treasury the trust already had when this script started.
// A hardcoded count silently under-drains and then step 5 fails, so the count
// is taken from the on-chain runway once the policy is set.
let CYCLES = 3;

const deployArg = process.argv.slice(2).find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const ORG = deployArg || (fs.existsSync(path.join(HERE, "trust.address")) ? fs.readFileSync(path.join(HERE, "trust.address"), "utf-8").trim() : "");

// Everything below targets the address resolved inside main(), so there is no
// module level ORG binding to get wrong when --deploy creates a new one.

function show(label, s) {
  console.log(
    `  ${label.padEnd(22)} status=${String(s.status).padEnd(12)} cycle=${String(s.cycle).padEnd(3)} ` +
      `treasury=${fmt(s.treasury_atto).padEnd(16)} runway=${String(s.runway_cycles).padEnd(5)} ` +
      `action=${String(s.last_action).padEnd(10)} keepers=${s.keeper_count} paid=${fmt(s.keeper_paid_atto)}`,
  );
}

async function ensureTemplate(ORG_ADDR) {
  const rules = JSON.parse(await readFrom(ORG_ADDR, "get_charter_rules"));
  if (rules.length > 0) {
    console.log(`\n[1] bootstrap_rules already done (${rules.length} rules), skipping`);
    return;
  }
  console.log("\n[1] bootstrap_rules (real LLM, validator committee must agree)");
  const r = await writeTo(ORG_ADDR, "bootstrap_rules");
  if (!r.ok) {
    console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    process.exit(1);
  }
  console.log(`  ${r.hash}`);
}

async function main() {
  let address = ORG;
  if (process.argv.includes("--deploy") || !address) {
    console.log("[deploy] deploying with the keeper as operator and founder");
    const d = await deployContract(fs.readFileSync(path.join(ROOT, "contracts", "fideicommis.py"), "utf-8"), [
      "Climate Fund",
      MISSION,
      CHARTER,
      client.account.address,
      "https://example.org/impact",
    ]);
    if (!d.ok) {
      console.log(`  FAILED at ${d.phase}: ${d.reason}`);
      process.exit(1);
    }
    console.log(`  ${d.hash}\n  address ${d.address}\n`);
    address = d.address;
    fs.writeFileSync(path.join(HERE, "trust.address"), address, "utf-8");
  }

  console.log(`org     : ${address}`);
  console.log(`keeper  : ${client.account.address}`);
  console.log(`balance : ${fmt(await balance())}`);
  console.log(`policy  : fund ${fmt(FUND)}, burn ${fmt(BURN)}/cycle, keeper ${fmt(KEEPER)}/cycle, tick ${TICK}s`);
  const summary = () => readFrom(address, "get_org_summary").then(JSON.parse);
  show("start", await summary());

  await ensureTemplate(address);

  console.log("\n[2] fund() with value");
  let r = await writeTo(address, "fund", [], FUND);
  if (!r.ok) {
    console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    process.exit(1);
  }
  console.log(`  ${r.hash}`);
  show("after fund", await summary());

  console.log("\n[3] set_policy()");
  r = await writeTo(address, "set_policy", [BURN, KEEPER, TICK]);
  if (!r.ok) {
    console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    process.exit(1);
  }
  console.log(`  ${r.hash}`);
  const afterPolicy = await summary();
  show("after set_policy", afterPolicy);
  // runway_cycles is the on-chain integer division of treasury by burn, so this
  // is exactly how many cycles remain before the estate is drained, plus the one
  // that discovers it. Clamped so a pre-funded trust cannot spin here for hours.
  CYCLES = Math.min(Number(afterPolicy.runway_cycles) + 1, 20);
  console.log(`  driving ${CYCLES} cycles: runway_cycles=${afterPolicy.runway_cycles}, plus the one that finds the floor`);

  for (let i = 1; i <= CYCLES; i += 1) {
    console.log(`\n[4.${i}] advance_cycle() ${i}/${CYCLES}`);
    r = await writeTo(address, "advance_cycle");
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      break;
    }
    console.log(`  ${r.hash}`);
    const state = await summary();
    show(`after cycle ${i}`, state);
    if (state.status !== "ACTIVE") {
      console.log(`  fideicommis is ${state.status}, ending the loop`);
      break;
    }
    if (i < CYCLES) {
      console.log(`  sleeping ${TICK + 15}s for the tick cooldown...`);
      await sleep((TICK + 15) * 1000);
    }
  }

  console.log("\n[5] advance_cycle() on a drained fideicommis, must be rejected");
  const preDrain = await summary();
  if (preDrain.status === "ACTIVE") {
    console.log(`  still ACTIVE with runway=${preDrain.runway_cycles}, so this proves nothing yet; the clamp stopped the loop early`);
  }
  const drained = await writeTo(address, "advance_cycle");
  console.log(`  ${drained.ok ? "UNEXPECTEDLY ACCEPTED" : `correctly rejected: ${drained.reason.slice(0, 130)}`}`);

  console.log("\n[6] fund() again to revive");
  r = await writeTo(address, "fund", [], FUND);
  console.log(r.ok ? `  ${r.hash}` : `  FAILED at ${r.phase}: ${r.reason}`);
  show("after revival", await summary());

  console.log("\n[7] mission log");
  for (const entry of JSON.parse(await readFrom(address, "get_mission_log", [0, 40]))) console.log(`  ${entry}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
