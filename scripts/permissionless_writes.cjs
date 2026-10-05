#!/usr/bin/env node
/**
 * The permissionless writes, against a live deployment.
 *
 * This exists because the write path was the largest untested surface in the project. The
 * contract itself was covered — eleven consensus tests on Studionet and 117 direct-mode
 * cases — but every one of those deployed its own copy, and no transaction had ever been
 * sent to the trust the reader is actually pointed at.
 *
 * Two of the reader's writes cannot be reached from here, and the reasons are facts about
 * the account rather than about the code:
 *
 *   - `fund` needs value and the keeper holds 0 GEN.
 *   - `cast_vote` is a member act and the single member of this trust is a different
 *     address than the key in `scripts/orgkeeper.key`.
 *
 * So this runs the three that are permissionless, which includes a real LLM judgment:
 * `bootstrap_rules`, `submit_proposal` and `assess_proposal`. Every step reads on-chain
 * state first, so an interrupted run resumes rather than repeating work.
 *
 * Run: node scripts/permissionless_writes.cjs
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

// Small, and under the 20 percent ceiling of a treasury that is currently empty. Nothing
// here can move money: the grant is never executed in this script, because execute needs a
// quorum this account cannot reach.
const GRANT = 2n * 10n ** 16n;

const TITLE = "Keep the named reference page reachable";
const BODY =
  `The work commissioned is to keep this public web page reachable: ${EVIDENCE} `
  + "The page is an open encyclopedia article on climate change adaptation. The deliverable "
  + "is that a member of the public can open that exact URL and read the article, without an "
  + "account, a paywall, or a login, and that it keeps returning that content. The requested "
  + "amount covers ongoing hosting and upkeep of that page.";

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

(async () => {
  console.log(`trust ${TRUST}`);
  line("caller", client.account.address);
  line("caller balance", fmt(await balance()));
  console.log();

  const members = JSON.parse(await read("get_members"));
  const isMember = members.some(
    (m) => String(m.address).toLowerCase() === client.account.address.toLowerCase(),
  );
  line("is a member", isMember ? "yes" : `no — the member is ${members[0]?.address}`);

  let s = await summary();
  line("status", s.status);
  line("treasury", fmt(s.treasury_atto));
  line("charter rules", s.charter_rule_count);
  console.log();

  // ---- 1. bootstrap_rules. Permissionless, once per charter version. --------------
  if (Number(s.charter_rule_count) === 0) {
    console.log("[1] bootstrap_rules — derives the rulebook from the charter");
    const r = await write("bootstrap_rules");
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    for (const rule of JSON.parse(await read("get_charter_rules"))) {
      console.log(`       ${rule.id}: ${rule.text}`);
    }
  } else {
    console.log("[1] bootstrap_rules — already derived, skipping");
  }

  s = await summary();
  console.log();

  // ---- 2. submit_proposal. Permissionless; only a member may vote on it. -----------
  const id = `p${Number(s.proposal_count) + 1}`;
  let p = await read("get_proposal", [id]).then(JSON.parse).catch(() => null);

  if (!p) {
    console.log(`[2] submit_proposal ${id}`);
    const r = await write("submit_proposal", [TITLE, BODY, "GRANT", GRANT, client.account.address]);
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    p = await read("get_proposal", [id]).then(JSON.parse);
  } else {
    console.log(`[2] submit_proposal ${id} — already exists, skipping`);
  }

  line("verdict", p.verdict);
  line("amount", fmt(p.amount_atto));
  line("recipient", p.recipient);
  console.log();

  // ---- 3. assess_proposal. Permissionless, and a real committee judgment. ----------
  if (p.verdict === "PENDING") {
    console.log(`[3] assess_proposal ${id} — real LLM, the committee must agree`);
    const r = await write("assess_proposal", [id]);
    if (!r.ok) {
      line("FAILED", `${r.phase}: ${r.reason}`);
      process.exit(1);
    }
    line("tx", r.hash);
    p = await read("get_proposal", [id]).then(JSON.parse);
  } else {
    console.log(`[3] assess_proposal ${id} — already assessed, skipping`);
  }

  line("verdict", p.verdict);
  line("violations", JSON.stringify(p.violations));
  console.log("\n       the committee's own reasoning:");
  for (const row of String(await read("get_proposal_audit", [id])).split("\\n")) {
    console.log(`         ${row}`);
  }

  const after = await summary();
  console.log();
  line("proposals now", after.proposal_count);
  line("treasury", fmt(after.treasury_atto));
  line("last action", after.last_action);
  console.log();
  console.log("  Not reached, and why:");
  line("  fund", "the caller holds 0 GEN, and fund() carries value");
  line("  cast_vote", isMember ? "available" : "only a member may vote, and the caller is not one");
  line("  execute_proposal", "needs quorum from a member, then the constitutional delay");
  console.log(`\n  ${id} is left assessed and unvoted. That is a real resting state, not a failure.`);
})();