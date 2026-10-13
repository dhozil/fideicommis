#!/usr/bin/env node
/**
 * End-to-end evidence for the financial-control review, on one live trust.
 *
 * Fully resumable: every phase reads on-chain state first and skips what
 * already happened, so the one-hour timelock wait in the middle is just a
 * re-run away. Run once to vote, run again after the delay to finish.
 *
 * What it demonstrates, in order:
 *
 *   [A] reconciliation now: real balance vs treasury plus retired.
 *   [B] recipient credits: the independent wallet's balance before/after.
 *   [C] keeper reward: set a small keeper rate, advance once, read it back.
 *   [D] burn governance lifecycle: submit BURN_PER_CYCLE, assess, vote, wait
 *       the timelock, execute. The operator cannot set it (set_policy takes
 *       keeper and tick only now).
 *   [E] capped burn: advance twice under the voted rate, show each cycle
 *       retired at most one percent, reconciliation still holding.
 *   [F] wind_down/dissolve refusals without a DISSOLVE authorisation.
 *
 * Failed transfers: with EOA recipients they do not occur live, and forcing
 * one would need a reverting receiver no honest grant would name. The
 * __on_errored_message__ path is proven in direct mode instead, and the
 * reconciliation reads here would expose any drift it ever missed.
 *
 * Env: RECIPIENT_ADDRESS (independent wallet), BURN_ATTO (default 0.01 GEN).
 * Run: node scripts/e2e_evidence.cjs <trust-address>
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));
const { makeDriver, fmt } = require("./studionet.cjs");

const TRUST = process.argv[2];
if (!TRUST || !/^0x[0-9a-fA-F]{40}$/.test(TRUST)) {
  console.error("usage: node scripts/e2e_evidence.cjs <trust-address>");
  process.exit(1);
}
const RECIPIENT = process.env.RECIPIENT_ADDRESS || "";
const BURN = BigInt(process.env.BURN_ATTO || "10000000000000000");

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

function keyFromStore() {
  const raw = fs.readFileSync("D:/Genlayer-project/wallet/.env", "utf-8").trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const named = lines.find((l) => l.startsWith("GENLAYER_DEV_KEY"));
  if (named) return named.split("=").slice(1).join("=").trim();
  return raw;
}

const client = createClient({ chain: chains.studionet, account: accountFrom(keyFromStore()) });
const { writeTo, readFrom, balance } = makeDriver(client);

const read = (m, args = []) => readFrom(TRUST, m, args);
const flow = () => read("get_lifetime_flow").then(JSON.parse);
const recon = () => read("get_treasury_reconciliation").then(JSON.parse);

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

async function recipientBalance() {
  try {
    return await client.getBalance({ address: RECIPIENT });
  } catch {
    return null;
  }
}

(async () => {
  console.log(`  trust ${TRUST}`);
  line("caller", client.account.address);
  line("name", await read("get_org_name"));

  console.log("\n[A] reconciliation now");
  const r0 = await recon();
  line("real balance", fmt(BigInt(r0.real_balance_atto)));
  line("treasury", fmt(BigInt(r0.treasury_atto)));
  line("retired", fmt(BigInt(r0.retired_atto)));
  line("holds", r0.holds);

  if (RECIPIENT) {
    console.log("\n[B] independent recipient credits");
    const rb = await recipientBalance();
    line("recipient", RECIPIENT);
    line("recipient balance", rb === null ? "(unreadable via SDK)" : fmt(BigInt(rb)));
    const ids = JSON.parse(await read("get_proposal_ids"));
    for (const id of ids) {
      try {
        const p = JSON.parse(await read("get_proposal", [id]));
        if (p.settled) line(`${id} paid to`, `${p.recipient} ${fmt(BigInt(p.delivery_payout))} second tranche`);
      } catch { /* unreadable, skip */ }
    }
  }

  console.log("\n[C] keeper reward");
  const k0 = (await flow()).keeper_paid_atto;
  const kset = await writeTo(TRUST, "set_policy", [5000000000000000n, 60]);
  line("set keeper 0.005", kset.ok ? "tx " + kset.hash : "REFUSED " + kset.reason);
  if (kset.ok) {
    const kadv = await writeTo(TRUST, "advance_cycle", []);
    line("advance", kadv.ok ? "tx " + kadv.hash : "REFUSED " + String(kadv.reason).slice(0, 80));
    const k1 = (await flow()).keeper_paid_atto;
    line("keeper_paid delta", fmt(BigInt(k1) - BigInt(k0)));
  }
  const krest = await writeTo(TRUST, "set_policy", [0, 60]);
  line("policy restored", krest.ok ? "yes" : "REFUSED");

  console.log("\n[D] burn governance lifecycle");
  const policy = JSON.parse(await read("get_policy"));
  line("burn_per_cycle now", fmt(BigInt(policy.burn_per_cycle)));
  const ids = JSON.parse(await read("get_proposal_ids"));
  let burnId = null;
  for (const id of ids) {
    try {
      const p = JSON.parse(await read("get_proposal", [id]));
      if (p.kind !== "GOVERNANCE" || p.executed) continue;
      if (p.verdict !== "PENDING" && p.verdict !== "COMPLIANT") continue;
      // The body lives on the audit view, not the proposal summary.
      const audit = JSON.parse(await read("get_proposal_audit", [id]));
      if (String(audit.body).startsWith("BURN_PER_CYCLE")) { burnId = id; break; }
    } catch { /* skip */ }
  }
  if (!burnId) {
    const sub = await writeTo(TRUST, "submit_proposal", ["Set burn rate", `BURN_PER_CYCLE:${BURN}`, "GOVERNANCE", 0, ""]);
    line("submit", sub.ok ? "tx " + sub.hash : "REFUSED " + sub.reason);
    if (sub.ok) {
      const all = JSON.parse(await read("get_proposal_ids"));
      burnId = all[all.length - 1];
    }
  } else {
    console.log(`\n[D] burn proposal exists: ${burnId}`);
  }
  if (burnId) {
    let p = JSON.parse(await read("get_proposal", [burnId]));
    line("verdict", p.verdict);
    if (p.verdict === "PENDING") {
      const a = await writeTo(TRUST, "assess_proposal", [burnId]);
      line("assess", a.ok ? "tx " + a.hash : "REFUSED " + String(a.reason).slice(0, 80));
      p = JSON.parse(await read("get_proposal", [burnId]));
      line("verdict now", p.verdict);
    }
    if (Number(p.approvals) === 0 && p.verdict === "COMPLIANT") {
      const v = await writeTo(TRUST, "cast_vote", [burnId, true]);
      line("vote", v.ok ? "tx " + v.hash : "REFUSED " + String(v.reason).slice(0, 80));
    }
    const e = await writeTo(TRUST, "execute_proposal", [burnId]);
    if (e.ok) {
      line("execute (delay crossed)", "tx " + e.hash);
      const after = JSON.parse(await read("get_policy"));
      line("burn_per_cycle now", fmt(BigInt(after.burn_per_cycle)));
    } else {
      line("execute", "REFUSED (delay running?) " + String(e.reason).slice(0, 90));
      console.log("  re-run after the timelock to finish [D] and run [E]");
      return;
    }
  }

  console.log("\n[E] capped burn cycles");
  for (let i = 1; i <= 2; i += 1) {
    const before = await flow();
    const adv = await writeTo(TRUST, "advance_cycle", []);
    line(`advance ${i}`, adv.ok ? "tx " + adv.hash : "REFUSED " + String(adv.reason).slice(0, 80));
    if (!adv.ok) break;
    const after = await flow();
    line(`retired delta ${i}`, fmt(BigInt(after.burned_atto) - BigInt(before.burned_atto)));
  }
  const r1 = await recon();
  line("reconciliation holds", r1.holds);

  console.log("\n[F] wind_down/dissolve refusals");
  const wd = await writeTo(TRUST, "wind_down", []);
  line("wind_down", wd.ok ? "ACCEPTED (BAD)" : "refused");
  const dv = await writeTo(TRUST, "dissolve", []);
  line("dissolve", dv.ok ? "ACCEPTED (BAD)" : "refused");
  line("status", await read("get_status"));
  console.log(`\n  reader /trust/${TRUST}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});
