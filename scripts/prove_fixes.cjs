#!/usr/bin/env node
/**
 * Live proof of the four portal-rejection fixes, on a trust that stays alive.
 *
 * Proves refusal paths and bounds without destroying the demo trust: the
 * authorised-dissolution flow (vote plus timelock, remainder to the named
 * recipient) is covered in direct mode, because running it here would dissolve
 * the showcase. What runs here:
 *
 *   1. wind_down without an executed DISSOLVE proposal is refused.
 *   2. dissolve without winding down is refused.
 *   3. A keeper reward set to the whole treasury pays exactly one percent:
 *      set_policy, one advance_cycle, read back keeper_paid, restore zeros.
 *   4. The conservation identity still holds afterwards.
 *
 * Run: node scripts/prove_fixes.cjs <trust-address>
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));
const { makeDriver, fmt } = require("./studionet.cjs");

const TRUST = process.argv[2];
if (!TRUST || !/^0x[0-9a-fA-F]{40}$/.test(TRUST)) {
  console.error("usage: node scripts/prove_fixes.cjs <trust-address>");
  process.exit(1);
}

function accountFrom(raw) {
  const body = String(raw).replace(/^0x/, "");
  for (const build of [
    () => createAccount(`0x${body}`),
    () => createAccount(Uint8Array.from(Buffer.from(body, "hex"))),
  ]) {
    try {
      return build();
    } catch {
      /* next form */
    }
  }
  throw new Error("no accepted form for the stored key");
}

const store = JSON.parse(fs.readFileSync("D:/Genlayer-project/wallet/credentials.json", "utf-8"));
const client = createClient({ chain: chains.studionet, account: accountFrom(store.privateKey) });
const { writeTo, readFrom } = makeDriver(client);

const read = (m, args = []) => readFrom(TRUST, m, args);
const flow = () => read("get_lifetime_flow").then(JSON.parse);

(async () => {
  console.log(`  trust ${TRUST}`);

  const wd = await writeTo(TRUST, "wind_down", []);
  console.log(`  [1] wind_down unauthorised: ${wd.ok ? "ACCEPTED (BAD)" : "refused: " + String(wd.reason).slice(0, 90)}`);

  const dv = await writeTo(TRUST, "dissolve", []);
  console.log(`  [2] dissolve not winding down: ${dv.ok ? "ACCEPTED (BAD)" : "refused: " + String(dv.reason).slice(0, 90)}`);

  const before = await flow();
  const treasury = BigInt(before.treasury_atto);
  console.log(`  treasury before: ${fmt(treasury)}`);
  const set = await writeTo(TRUST, "set_policy", [0, treasury, 60]);
  console.log(`  [3] set keeper reward to 100% of treasury: ${set.ok ? "tx " + set.hash : "REFUSED " + set.reason}`);
  const adv = await writeTo(TRUST, "advance_cycle", []);
  console.log(`      advance_cycle: ${adv.ok ? "tx " + adv.hash : "REFUSED " + String(adv.reason).slice(0, 80)}`);
  const after = await flow();
  const paid = BigInt(after.keeper_paid_atto) - BigInt(before.keeper_paid_atto);
  const want = (treasury * 100n) / 10000n;
  console.log(`      keeper paid this cycle: ${fmt(paid)} (cap 1% = ${fmt(want)}) ${paid === want ? "CAPPED" : "MISMATCH"}`);
  const restore = await writeTo(TRUST, "set_policy", [0, 0, 60]);
  console.log(`      policy restored to zeros: ${restore.ok ? "yes" : "REFUSED " + restore.reason}`);

  const f = await flow();
  const buckets = ["treasury_atto", "granted_atto", "settled_atto", "dissolved_atto", "keeper_paid_atto", "burned_atto"]
    .reduce((s, k) => s + BigInt(f[k] ?? 0), 0n);
  console.log(`  [4] identity holds: ${BigInt(f.inflow_atto) === buckets}`);
  console.log(`  status: ${await read("get_status")}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});
