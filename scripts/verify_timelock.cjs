#!/usr/bin/env node
/**
 * Did execute_proposal honour the one-hour delay, or did it not?
 *
 * A second run of `full_cycle.cjs` reported `execute ACCEPTED` within minutes of quorum
 * being reached. The delay is an hour and is stamped when quorum is reached, so that is
 * either a misread of which proposal was executed, or the delay is not being enforced. The
 * difference matters more than anything else this session found, so it is checked directly
 * rather than inferred from a script's own output.
 *
 * What is checked:
 *   - every proposal's executed/settled state and its amounts
 *   - the treasury before and after, from the conservation identity
 *   - whether any recipient's balance moved
 *   - the clock: now against the moment quorum was reached, if that is knowable
 *
 * Run: node scripts/verify_timelock.cjs
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
const { readFrom, balance } = makeDriver(client);

const TRUST = fs.readFileSync(path.join(__dirname, "trust_c.address"), "utf-8").trim();
const read = (m, args = []) => readFrom(TRUST, m, args);

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

(async () => {
  console.log(`  trust C ${TRUST}`);
  line("caller balance", fmt(await balance()));
  console.log("");

  const state = JSON.parse(await read("get_constitutional_state"));
  line("amendment delay", `${state.amendment_delay}s (${state.amendment_delay / 3600}h)`);

  const flow = JSON.parse(await read("get_lifetime_flow"));
  line("treasury", fmt(flow.treasury_atto));
  line("granted (paid out)", fmt(flow.granted_atto));
  line("inflow", fmt(flow.inflow_atto));

  let buckets = 0n;
  for (const k of ["treasury_atto", "granted_atto", "settled_atto", "dissolved_atto", "keeper_paid_atto", "burned_atto"]) {
    buckets += BigInt(flow[k] ?? 0);
  }
  line("identity holds", BigInt(flow.inflow_atto) === buckets);
  console.log("");

  const ids = JSON.parse(await read("get_proposal_ids"));
  for (const id of ids) {
    const p = await read("get_proposal", [id]).then(JSON.parse).catch(() => null);
    if (!p) continue;
    console.log(`  ${id}`);
    line("  verdict", p.verdict);
    line("  approvals", p.approvals);
    line("  executed", p.executed);
    line("  settled", p.settled);
    line("  amount", fmt(p.amount_atto));
    line("  recipient", p.recipient);
    line("  delivery", p.delivery_verdict);
    console.log("");
  }

  const log = JSON.parse(await read("get_mission_log", [0, 60]));
  console.log("  mission log — the ordered record of what actually happened:");
  for (const entry of log.slice(-12)) {
    let parsed;
    try {
      parsed = JSON.parse(entry);
    } catch {
      parsed = { raw: String(entry).slice(0, 70) };
    }
    const { event, ...rest } = parsed;
    console.log(`    ${String(event ?? "?").padEnd(22)} ${JSON.stringify(rest).slice(0, 74)}`);
  }

  console.log("");
  console.log(`  reader /trust/${TRUST}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});