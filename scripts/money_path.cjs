#!/usr/bin/env node
/**
 * The money path, as far as this account is allowed to take it.
 *
 * `scripts/permissionless_writes.cjs` got three writes onto a live deployment and then
 * stopped, because the trust had no treasury: the committee correctly refused a grant whose
 * ceiling was zero, and said why. That was the system working, but it left the money path
 * unproven — nothing had ever moved.
 *
 * The keeper now holds GEN, so the treasury can be funded and a grant can be assessed
 * against a ceiling that is not zero. What still cannot happen is the vote: this account is
 * not the single member of the trust, and `cast_vote` is a member act. So the flow runs to
 * the point where a member's signature is the only thing missing, and reports that as the
 * boundary rather than pretending to have gone further.
 *
 * Resumable: each step reads on-chain state first.
 *
 * Run: node scripts/money_path.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, fmt } = require("./studionet.cjs");

const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom, writeTo, balance } = makeDriver(client);

const TRUST = fs.readFileSync(path.join(__dirname, "trust.address"), "utf-8").trim();
const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";

const read = (m, args = []) => readFrom(TRUST, m, args);
const write = (m, args = [], v = 0n) => writeTo(TRUST, m, args, v);
const summary = () => read("get_org_summary").then(JSON.parse);

// Funding 1 GEN puts the ceiling at 20 percent and rule R1 at 10 percent of it, so a grant
// of 0.05 GEN sits inside both with room to spare. The amounts are chosen against the
// trust's own policy rather than guessed, and the ceiling is read back afterwards to prove
// it — a compliant verdict on numbers nobody checked would be worth very little.
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

(async () => {
  console.log(`trust ${TRUST}`);
  line("caller", client.account.address);
  line("caller balance", fmt(await balance()));

  const members = JSON.parse(await read("get_members"));
  const isMember = members.some(
    (m) => String(m.address).toLowerCase() === client.account.address.toLowerCase(),
  );
  line("is a member", isMember ? "yes" : `no — member is ${members[0]?.address}`);

  const policy = JSON.parse(await read("get_policy"));
  let s = await summary();
  console.log();
  line("treasury before", fmt(s.treasury_atto));
  line("spend ceiling", fmt(policy.spend_ceiling_atto));

  // ---- fund. Permissionless, and the only write that carries value. ---------------
  if (BigInt(s.treasury_atto) === 0n) {
    console.log(`\n[1] fund() with ${fmt(FUND)}`);
    const r = await write("fund", [], FUND);
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    s = await summary();
  } else {
    console.log("\n[1] fund() — treasury is not empty, skipping");
  }

  const afterFund = JSON.parse(await read("get_policy"));
  line("treasury after", fmt(s.treasury_atto));
  line("spend ceiling now", fmt(afterFund.spend_ceiling_atto));
  line("grant asking", fmt(GRANT));
  const insideCeiling = BigInt(afterFund.spend_ceiling_atto) >= GRANT;
  line("inside the ceiling", insideCeiling ? "yes" : "NO — a refusal would be correct");

  // ---- submit + assess. The previous proposal is stuck at NON_COMPLIANT and cannot be
  //      re-assessed, because the contract refuses a verdict that is no longer PENDING. That
  //      is why this is a new proposal and not a retry. ---------------------------------
  const id = `p${Number(s.proposal_count) + 1}`;
  let p = await read("get_proposal", [id]).then(JSON.parse).catch(() => null);

  if (!p) {
    console.log(`\n[2] submit_proposal ${id}`);
    const r = await write("submit_proposal", [TITLE, BODY, "GRANT", GRANT, client.account.address]);
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    p = await read("get_proposal", [id]).then(JSON.parse);
  } else {
    console.log(`\n[2] submit_proposal ${id} — already exists`);
  }
  line("verdict", p.verdict);

  if (p.verdict === "PENDING") {
    console.log(`\n[3] assess_proposal ${id} — real LLM`);
    const r = await write("assess_proposal", [id]);
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    p = await read("get_proposal", [id]).then(JSON.parse);
  }
  line("verdict", p.verdict);
  line("violations", JSON.stringify(p.violations));
  line("rationale", String(p.rationale ?? "").slice(0, 200));

  console.log("\n[4] cast_vote — this is the boundary");
  if (!isMember) {
    console.log("  not attempted: only a member may vote, and this account is not one.");
    console.log("  The contract refuses it, and refusing it is the correct behaviour.");
  } else {
    const r = await write("cast_vote", [id, true]);
    line("cast_vote", r.ok ? r.hash : `${r.phase}: ${r.reason}`);
  }

  const after = await summary();
  console.log();
  line("proposals", after.proposal_count);
  line("treasury", fmt(after.treasury_atto));
  line("last action", after.last_action);
  console.log(`\n  ${id} is left ${p.verdict} and unvoted. Nothing has been paid out:`);
  console.log("  the money path stops at a member's signature, which is the design working.");
})();