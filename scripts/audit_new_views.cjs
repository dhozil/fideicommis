#!/usr/bin/env node
/**
 * Audit the six views the reader added, against the deployed trust.
 *
 * These six methods answer on every page load and nothing displayed them until the last
 * commit, so they are the least-exercised code in the reader. This probes each one
 * exactly as the reader calls it, and reports what actually came back.
 *
 * Run: node scripts/audit_new_views.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver } = require("./studionet.cjs");

const address = fs.readFileSync(path.join(__dirname, "trust.address"), "utf-8").trim();

const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom } = makeDriver(client);

// Each entry is [method, args] exactly as frontend/src/lib/trust.ts sends it.
const CALLS = [
  ["get_org_summary", []],
  ["get_status", []],
  ["get_treasury", []],
  ["get_mission", []],
  ["get_charter_history", []],
  ["get_evidence_urls", []],
  ["get_mission_log", []],
];

(async () => {
  console.log(`trust ${address}\n`);

  for (const [method, args] of CALLS) {
    try {
      const raw = await readFrom(address, method, args);
      const shown = typeof raw === "string" ? raw.slice(0, 200) : JSON.stringify(raw).slice(0, 200);
      console.log(`  ok    ${method}(${args.join(", ")})`);
      console.log(`        ${shown}`);
    } catch (err) {
      console.log(`  FAIL  ${method}(${args.join(", ")})`);
      console.log(`        ${(err.message ?? String(err)).slice(0, 240)}`);
    }
  }

  // The one signature the reader cannot call blind: `get_mission_log(offset, limit)`
  // takes two arguments. Probing it with the offset a reader would want proves the
  // call works and shows what a full log looks like.
  console.log("\n=== get_mission_log with the arguments it requires ===");
  try {
    const raw = await readFrom(address, "get_mission_log", [0, 20]);
    console.log(`  ok    get_mission_log(0, 20)`);
    console.log(`        ${String(raw).slice(0, 300)}`);
  } catch (err) {
    console.log(`  FAIL  get_mission_log(0, 20) — ${(err.message ?? String(err)).slice(0, 240)}`);
  }
})();