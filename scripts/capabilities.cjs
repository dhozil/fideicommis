#!/usr/bin/env node
/**
 * What each deployed trust actually exposes.
 *
 * The reader now offers `bootstrap_rules`, `assess_proposal` and `set_code_upgraders`,
 * which were added to the contract after the oldest listed deployment was made. Studionet
 * cannot upgrade a contract, so an address from an earlier build does not have them, and a
 * button for a method that is not there fails at the node with a message that does not say
 * which method was missing.
 *
 * Three ways of finding out what a deployment has were tried, and only one worked:
 *
 *   - `readContract` on each write method: useless. A write called as a view answers
 *     "Missing or invalid parameters" — and so does `clear_rules`, which is also a write,
 *     and so does a method name invented on the spot. All three are indistinguishable.
 *   - the SDK's `getContractSchema`: fails node-side with a psycopg2 error on this build.
 *   - raw `gen_getContractSchema` over JSON-RPC: works, and returns `ctor` and `methods`.
 *
 * The SDK's version is the one that is broken, so this goes around it deliberately. That is
 * the same reason `scripts/studionet.cjs` uses the Node SDK rather than hand-rolled RPC:
 * each layer has to be measured rather than trusted.
 *
 * Run: node scripts/capabilities.cjs
 */

const fs = require("fs");
const path = require("path");

const RPC = "https://studio.genlayer.com/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read through this list of addresses. `trust.address` and `trust_b.address` are the two
// deployments the drivers use; the older one is here too because it is the case this script
// exists for.
const ADDRESSES = [
  ["current", "0x76051A36dCB316bD7Bf272692B3e3f7930170597"],
  ["trust_b", "0xaEDf11fD920Fc8C06EB6754387072C97D0e468aF"],
  ["older build", "0x89D3E2F937a265583BF308F2d5250445e1f7113F"],
];

/** The writes the reader offers. A deployment missing any of these cannot be driven. */
const WRITES = [
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
  "set_evidence_urls",
  "set_member_shares",
  "clear_rules",
];

async function schema(address) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "gen_getContractSchema",
          params: [address],
        }),
      });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message ?? "rpc error");
      return body.result;
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(12000);
    }
  }
}

(async () => {
  console.log(`Studionet schema probe — ${new Date().toISOString()}\n`);

  const found = new Map();

  for (const [label, address] of ADDRESSES) {
    let result;
    try {
      result = await schema(address);
    } catch (err) {
      console.log(`  ${label.padEnd(13)} ${address.slice(0, 10)}...  schema unavailable: ${(err.message ?? String(err)).slice(0, 60)}`);
      continue;
    }

    const methods = result?.methods ?? {};
    const names = new Set(
      (Array.isArray(methods) ? methods : Object.keys(methods)).map((m) =>
        typeof m === "string" ? m : m?.name ?? m?.function,
      ),
    );
    found.set(address, names);

    const missing = WRITES.filter((m) => !names.has(m));
    console.log(`  ${label.padEnd(13)} ${address.slice(0, 10)}...  ${names.size} methods`);
    console.log(
      `    missing writes: ${missing.length ? missing.join(", ") : "none — every write the reader offers exists here"}`,
    );
    await sleep(9000);
  }

  // The comparison that matters: what a build older than the reader's buttons lacks.
  const [newest, ...older] = ADDRESSES;
  if (found.size > 1) {
    const newestNames = found.get(newest[1]);
    console.log(`\n=== what an older deployment is missing, against ${newest[0]} ===`);
    for (const [label, address] of older) {
      const names = found.get(address);
      if (!names || !newestNames) continue;
      const absent = WRITES.filter((m) => newestNames.has(m) && !names.has(m));
      console.log(
        `  ${label}: ${absent.length ? absent.join(", ") : "nothing the reader offers"}`,
      );
    }
  }
})();