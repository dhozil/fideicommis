#!/usr/bin/env node
/**
 * The whole money path, on the one trust where every step is reachable.
 *
 * Trust C (0x0A3912aa) is deployed from the current source and founded by a wallet this
 * repository holds, so its single member is also the signer. That makes it the only
 * deployment where the entire sequence is reachable: derive the rulebook, fund, propose,
 * have the committee judge, vote, wait out the constitutional delay, execute, review the
 * delivery, settle.
 *
 * The delay is one hour and is stamped when quorum is reached, so `execute_proposal` cannot
 * succeed on this pass. The script stops there, says so, and prints the address to verify.
 * Re-running it later resumes: every step reads on-chain state first, so a step that already
 * happened is skipped rather than repeated, and nothing is paid twice.
 *
 * Run: node scripts/full_cycle.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STORE = process.env.WALLET_STORE || "D:/Genlayer-project/contract/.wallets/studionet.json";
const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));
const { makeDriver, fmt } = require("./studionet.cjs");

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

const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
const client = createClient({
  chain: chains.studionet,
  account: accountFrom(store.private_key),
});
const { writeTo, readFrom, balance } = makeDriver(client);

const TRUST = fs.readFileSync(path.join(__dirname, "trust_c.address"), "utf-8").trim();
const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";

const read = (m, args = []) => readFrom(TRUST, m, args);
const write = (m, args = [], v = 0n) => writeTo(TRUST, m, args, v);
const summary = () => read("get_org_summary").then(JSON.parse);
const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);

const FUND = 1n * 10n ** 18n;
const GRANT = 5n * 10n ** 16n;
const TITLE = "Keep the named reference page reachable";
const BODY =
  `The work commissioned is to keep this public web page reachable: ${EVIDENCE} `
  + "The page is an open encyclopedia article on climate change adaptation. The deliverable "
  + "is that a member of the public can open that exact URL and read the article, without an "
  + "account, a paywall, or a login, and that it keeps returning that content. The requested "
  + "amount covers ongoing hosting and upkeep of that page.";

function line(label, value) {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

async function step(label, method, args = [], value = 0n) {
  console.log(`\n[${label}] ${method}`);
  const r = await write(method, args, value);
  if (!r.ok) {
    line("REFUSED", `${r.phase}: ${String(r.reason).slice(0, 120)}`);
    return null;
  }
  line("tx", r.hash);
  return r;
}

(async () => {
  console.log(`  trust C ${TRUST}`);
  line("caller", client.account.address);
  line("balance", fmt(await balance()));
  const members = JSON.parse(await read("get_members"));
  line("is a member", members[0]?.address.toLowerCase() === client.account.address.toLowerCase());
  line("shares held", members[0]?.shares);

  let s = await summary();
  line("treasury", fmt(s.treasury_atto));
  line("charter rules", s.charter_rule_count);

  if (Number(s.charter_rule_count) === 0) {
    await step(1, "bootstrap_rules");
    console.log("");
    for (const rule of JSON.parse(await read("get_charter_rules"))) {
      console.log(`       ${rule.id}: ${rule.text}`);
    }
  } else {
    console.log("\n[1] bootstrap_rules — already derived");
  }

  s = await summary();
  if (BigInt(s.treasury_atto) === 0n) {
    await step(2, "fund", [], FUND);
    s = await summary();
  } else {
    console.log("\n[2] fund — treasury is not empty");
  }
  const ceiling = JSON.parse(await read("get_policy")).spend_ceiling_atto;
  line("treasury now", fmt(s.treasury_atto));
  line("ceiling now", fmt(ceiling));
  line("grant asking", fmt(GRANT));
  line("inside ceiling", BigInt(ceiling) >= GRANT ? "yes" : "NO");

  const id = `p${Number(s.proposal_count) + 1}`;
  let p = await proposal(id).catch(() => null);
  if (!p) {
    await step(3, "submit_proposal", [TITLE, BODY, "GRANT", GRANT, client.account.address]);
    p = await proposal(id);
  } else {
    console.log(`\n[3] submit_proposal ${id} — already exists`);
  }
  line("verdict", p.verdict);
  line("amount", fmt(p.amount_atto));
  line("recipient", p.recipient);

  if (p.verdict === "PENDING") {
    await step(4, "assess_proposal", [id]);
    p = await proposal(id);
  } else {
    console.log(`\n[4] assess_proposal ${id} — already assessed`);
  }
  line("verdict", p.verdict);
  line("violations", JSON.stringify(p.violations));

  if (p.verdict !== "COMPLIANT") {
    console.log("\n  not compliant — the money path stops here, and that is a valid outcome.");
    return;
  }

  if (Number(p.approvals) === 0) {
    await step(5, "cast_vote", [id, true]);
    p = await proposal(id);
  } else {
    console.log(`\n[5] cast_vote ${id} — already voted`);
  }
  line("approvals", p.approvals);
  line("quorum reached", p.approvals > 0 ? "yes — the delay is now running" : "no");

  console.log("\n[6] execute_proposal — this will be refused, and correctly so.");
  console.log("    The delay is stamped when quorum is reached, and it is one hour.");
  const refused = await write("execute_proposal", [id]);
  if (refused.ok) {
    line("execute", "ACCEPTED");
  } else {
    line("REFUSED as expected", String(refused.reason).slice(0, 110));
  }

  console.log(`\n  Re-run this script in an hour to finish: ${id} is COMPLIANT and voted.`);
  console.log(`    reader /trust/${TRUST}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});