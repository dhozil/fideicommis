#!/usr/bin/env node
/**
 * The last two steps: the delivery review and the settlement.
 *
 * Both proposals on trust C are executed and paid, with `delivery = NONE` and
 * `settled = false`. That is not a failure state — a grant pays out in two tranches, and
 * the second one is withheld until someone shows the committee that the work was actually
 * delivered. This runs `review_delivery`, which fetches the named URL and judges it with a
 * real model, and then `settle_delivery`, which releases the remainder.
 *
 * It also corrects an assumption this file's predecessor got wrong. `full_cycle.cjs`
 * announced that `execute_proposal` "will be refused, and correctly so" on the grounds that
 * the constitutional delay had not elapsed. That is not the rule: the delay is enforced only
 * for CHARTER_AMENDMENT and GOVERNANCE (`CONSTITUTIONAL_KINDS`, checked in `execute_proposal`
 * before the branch), and a GRANT is not one of them. So the execute succeeded, correctly.
 * A script that predicted a refusal and watched a success is a script whose prediction was
 * never checked against the contract.
 *
 * Resumable: each step reads state first.
 *
 * Run: node scripts/finish_settlements.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));
const { makeDriver, fmt } = require("./studionet.cjs");

const store = JSON.parse(
  fs.readFileSync(
    process.env.WALLET_STORE || "D:/Genlayer-project/contract/.wallets/studionet.json",
    "utf-8",
  ),
);
const client = createClient({
  chain: chains.studionet,
  account: createAccount(`0x${String(store.private_key).replace(/^0x/, "")}`),
});
const { writeTo, readFrom, balance } = makeDriver(client);

const TRUST = fs.readFileSync(path.join(__dirname, "trust_c.address"), "utf-8").trim();
const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";

const read = (m, args = []) => readFrom(TRUST, m, args);
const write = (m, args = [], v = 0n) => writeTo(TRUST, m, args, v);
const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);

function line(label, value) {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

async function doStep(label, method, args) {
  console.log(`\n[${label}] ${method}`);
  const r = await write(method, args);
  if (!r.ok) {
    line("REFUSED", `${r.phase}: ${String(r.reason).slice(0, 120)}`);
    return false;
  }
  line("tx", r.hash);
  return true;
}

(async () => {
  console.log(`  trust C ${TRUST}`);
  line("caller balance", fmt(await balance()));

  const ids = JSON.parse(await read("get_proposal_ids"));
  let flowBefore;
  for (const id of ids) {
    let p = await proposal(id).catch(() => null);
    if (!p) continue;

    console.log(`\n  --- ${id} ---`);
    line("executed", p.executed);
    line("delivery", p.delivery_verdict);

    if (!p.executed) {
      console.log("  not executed — nothing to review");
      continue;
    }

    if (p.delivery_verdict === "NONE") {
      if (await doStep(`${id} review`, "review_delivery", [id, EVIDENCE])) {
        p = await proposal(id);
        line("verdict", p.delivery_verdict);
        line("score", p.delivery_score);
        line("payout", fmt(p.delivery_payout));
      }
    } else {
      console.log(`\n[${id} review] already judged: ${p.delivery_verdict} (score ${p.delivery_score})`);
    }

    if (p.delivery_verdict === "ACCEPTED" && !p.settled) {
      if (await doStep(`${id} settle`, "settle_delivery", [id])) {
        p = await proposal(id);
        line("settled", p.settled);
      }
    }
  }

  console.log("\n=== the ledger afterwards ===");
  flowBefore = JSON.parse(await read("get_lifetime_flow"));
  for (const key of [
    "inflow_atto",
    "treasury_atto",
    "granted_atto",
    "settled_atto",
    "dissolved_atto",
    "keeper_paid_atto",
    "burned_atto",
  ]) {
    line(key.replace("_atto", ""), fmt(flowBefore[key] ?? 0));
  }

  let buckets = 0n;
  for (const k of ["treasury_atto", "granted_atto", "settled_atto", "dissolved_atto", "keeper_paid_atto", "burned_atto"]) {
    buckets += BigInt(flowBefore[k] ?? 0);
  }
  line("identity holds", BigInt(flowBefore.inflow_atto) === buckets);
  line("caller balance", fmt(await balance()));
  console.log(`\n  reader /trust/${TRUST}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});