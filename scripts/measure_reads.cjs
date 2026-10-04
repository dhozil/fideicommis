#!/usr/bin/env node
/**
 * Where the trust page's time actually goes.
 *
 * The page felt slow, and the fix was not "add a spinner" — it is a page that asks the
 * node for sixteen views on every visit against a limit of thirty requests a minute. So
 * this measures two things that were previously assumed:
 *
 *   1. What `get_org_summary` already carries, because three of the six views added
 *      recently may be fields the summary was returning all along.
 *   2. What the sixteen reads cost, serially and in parallel, because "batched" was used
 *      to mean "concurrent" and those are different things against a rate limit.
 *
 * Run: node scripts/measure_reads.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, sleep } = require("./studionet.cjs");

const address = fs.readFileSync(path.join(__dirname, "trust.address"), "utf-8").trim();
const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom, paced } = makeDriver(client);

const FIXED = [
  ["get_org_summary", []],
  ["get_next_tick_at", []],
  ["get_lifetime_flow", []],
  ["get_constitution", []],
  ["get_constitutional_state", []],
  ["get_policy", []],
  ["get_members", []],
  ["get_charter_rules", []],
  ["get_charter", []],
  ["get_proposal_ids", []],
  ["get_status", []],
  ["get_treasury", []],
  ["get_mission", []],
  ["get_charter_history", []],
  ["get_evidence_urls", []],
  ["get_mission_log", [0, 50]],
];

(async () => {
  console.log(`trust ${address}\n`);

  console.log("=== what get_org_summary already carries ===");
  {
    const raw = await readFrom(address, "get_org_summary", []);
    const summary = JSON.parse(String(raw));
    for (const key of Object.keys(summary).sort()) {
      const value = summary[key];
      const shown = typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}…` : JSON.stringify(value);
      console.log(`  ${key.padEnd(22)} ${shown}`);
    }
    console.log("\n  fields: " + Object.keys(summary).length);
  }

  console.log("\n=== the sixteen reads, concurrently (what the page does) ===");
  {
    const started = Date.now();
    const results = await Promise.all(
      FIXED.map(async ([method, args]) => {
        try {
          return await readFrom(address, method, args);
        } catch (err) {
          return `ERROR: ${(err.message ?? "").slice(0, 60)}`;
        }
      }),
    );
    console.log(`  16 concurrent reads: ${Date.now() - started} ms`);
    results.forEach((value, index) => {
      const [method] = FIXED[index];
      const failed = String(value).startsWith("ERROR:");
      const size = failed ? 0 : String(value).length;
      console.log(`  ${failed ? "FAIL" : "ok  "}  ${method.padEnd(24)} ${failed ? String(value).slice(0, 58) : `${size} bytes`}`);
    });
  }

  console.log("\n=== the same sixteen, one at a time ===");
  {
    const started = Date.now();
    for (const [method, args] of FIXED) {
      try {
        await readFrom(address, method, args);
      } catch {
        /* counted either way */
      }
    }
    console.log(`  16 serial reads: ${Date.now() - started} ms`);
  }

  console.log("\n=== one read, to separate node latency from request count ===");
  {
    const started = Date.now();
    await readFrom(address, "get_status", []);
    console.log(`  a single read: ${Date.now() - started} ms`);
  }

  await sleep(1000);
})();