#!/usr/bin/env node
/**
 * Fideicommis end to end on real GenVM: the three claims the project makes.
 *
 * Everything verified so far had the fideicommis choosing HOLD or WIND_DOWN, so
 * the two guards that decide whether a model may cause money to leave have never
 * run on a real network:
 *
 *   FUND    the model names a grant; the contract pays it only if the proposal is
 *           genuinely COMPLIANT, unexecuted, unsettled and past quorum, and the
 *           amount fits the on-chain ceiling. A wrong proposal_id degrades to HOLD.
 *   SETTLE  the model names an accepted delivery; the contract pays the remaining
 *           tranche only for work the committee already ACCEPTED.
 *
 * Plus the adaptation claim:
 *
 *   AMEND   the fideicommis rewrites its own charter, but only through the
 *           ordinary path, assessed against the charter currently in force.
 *
 * The fideicommis is deployed directly rather than through the factory, so the
 * keeper is the founder and holds all the shares from the start. Grants pay a
 * non-member beneficiary, so the money genuinely leaves the trust.
 *
 * Setup, once:
 *   genlayer account send <keeper> 0.6gen
 *   and put the keeper key at scripts/orgkeeper.key (gitignored)
 *
 * Usage:
  node scripts/run_fideicommis.cjs          # reuse the recorded trust
  node scripts/run_fideicommis.cjs --new     # deploy a fresh trust first
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, sleep, fmt } = require("./studionet.cjs");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const client = makeClient(path.join(HERE, process.env.FIDE_KEY_FILE || "orgkeeper.key"));
const { readFrom, writeTo, deployContract, balance } = makeDriver(client);

const STATE_FILE = path.join(HERE, "trust.address");

// A separate account, so disbursements leave the trust instead of returning to
// the operator. This is the whole point of paying a grantee.
const BENEFICIARY = "0xb94e5cb14acfaabd03aa69f599a30a3799c773af";

const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";
const MISSION = "Keep public climate-adaptation reference material continuously reachable.";
const CHARTER = [
  "This fideicommis maintains a public archive of climate-adaptation reference material.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: every grant must be to keep a public web page reachable, and the grant body must name the exact public URL to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: a proposal to change these rules is decided the same way an ordinary grant is decided, by committee assessment and by member vote, and the rules in this charter do not by themselves constrain such a proposal.",
].join(" ");

const NEW_CHARTER = [
  "This fideicommis maintains a public archive of climate-adaptation reference material and publishes an annual summary of what it kept online.",
  "Rule 1: no single grant may exceed 20 percent of the treasury.",
  "Rule 2: every grant must be to keep a public web page reachable, and the grant body must name the exact public URL to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: a proposal to change these rules is decided the same way an ordinary grant is decided, by committee assessment and by member vote, and the rules in this charter do not by themselves constrain such a proposal.",
  "Rule 6: the fideicommis must publish a yearly summary of the pages it keeps online.",
].join(" ");

const GRANT_TITLE = "Keep the named public page reachable";
const GRANT_BODY =
  `The work commissioned is to keep this public web page reachable: ${EVIDENCE} `
  + "The page is an open encyclopedia article on climate change adaptation. "
  + "The deliverable is that a member of the public can open that exact URL and read the article, "
  + "without an account, a paywall, or a login, and that it keeps returning that content. "
  + "The requested amount covers the ongoing hosting and upkeep of that page.";

const FUND = 40n * 10n ** 16n; // 0.4 GEN
const GRANT = 2n * 10n ** 16n; // 0.02 GEN, 5 percent of a 0.4 GEN treasury
const TICK = 60;

let ORG = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, "utf-8").trim() : "";
const read = (m, args = []) => readFrom(ORG, m, args);
const write = (m, args = [], v = 0n) => writeTo(ORG, m, args, v);
const summary = () => read("get_org_summary").then(JSON.parse);
const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);

function show(label, s) {
  console.log(
    `  ${label.padEnd(26)} treasury=${fmt(s.treasury_atto).padEnd(16)} ` +
      `proposals=${s.proposal_count} executed=${s.executed_count} settled=${s.settled_count} ` +
      `charter_v=${s.charter_version} cycle=${s.cycle} action=${s.last_action}`,
  );
}

function step(label, ok, detail = "") {
  console.log(`  ${label.padEnd(30)} ${ok ? "ok" : "FAILED"}${detail ? `  ${detail}` : ""}`);
  return ok;
}

async function setup() {
  if (ORG && !process.argv.includes("--new")) {
    try {
      const s = await summary();
      console.log(`reusing ${ORG}  status=${s.status}  treasury=${fmt(s.treasury_atto)}`);
      return ORG;
    } catch (err) {
      console.log(`  cached trust not readable: ${String(err.message).slice(0, 80)}`);
    }
  }
  console.log("\n[1] deploy the trust, with the keeper as operator and founder");
  const d = await deployContract(
    fs.readFileSync(path.join(ROOT, "contracts", "fideicommis.py"), "utf-8"),
    ["Open Archive Trust", MISSION, CHARTER, client.account.address, EVIDENCE],
  );
  if (!d.ok) {
    console.log(`  FAILED at ${d.phase}: ${d.reason}`);
    process.exit(1);
  }
  ORG = d.address;
  fs.writeFileSync(STATE_FILE, ORG, "utf-8");
  console.log(`  ${d.hash}\n  address ${ORG}`);
  return ORG;
}

async function bootstrap() {
  if (Number((await summary()).charter_rule_count) > 0) return;
  console.log("\n[2] bootstrap_rules");
  const r = await write("bootstrap_rules");
  if (!r.ok) return console.log(`  FAILED at ${r.phase}: ${r.reason}`);
  console.log(`  ${r.hash}`);
  for (const rule of JSON.parse(await read("get_charter_rules"))) console.log(`    ${rule.id}: ${rule.text}`);
}

async function fund() {
  if (Number((await summary()).treasury_atto) > 0) return;
  console.log(`\n[3] fund() ${fmt(FUND)}`);
  const r = await write("fund", [], FUND);
  if (!r.ok) return console.log(`  FAILED at ${r.phase}: ${r.reason}`);
  console.log(`  ${r.hash}`);
}

async function policy() {
  const p = JSON.parse(await read("get_policy"));
  if (p.tick_interval === TICK) return;
    console.log("\n[4] set_policy so the cooldown is 60s (the ceiling and quorum are constitutional now)");
  const r = await write("set_policy", [0n, 0n, TICK]);
  if (!r.ok) return console.log(`  FAILED at ${r.phase}: ${r.reason}`);
  console.log(`  ${r.hash}`);
  console.log(`  ${await read("get_policy")}`);
}

/** Stage an approved but unpaid grant, so the model has something to act on. */
async function stageGrant() {
  const s = await summary();
  const id = `p${Number(s.proposal_count) + 1}`;
  let p = await proposal(id).catch(() => null);
  if (!p) {
    console.log(`\n[5] submit_proposal ${id} to ${BENEFICIARY} (deliberately left unpaid)`);
    const r = await write("submit_proposal", [GRANT_TITLE, GRANT_BODY, "GRANT", GRANT, BENEFICIARY]);
    if (!r.ok) return { error: `submit: ${r.reason}` };
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }
  if (p.verdict === "PENDING") {
    console.log(`\n[6] assess_proposal ${id}`);
    const r = await write("assess_proposal", [id]);
    if (!r.ok) return { error: `assess: ${r.reason}` };
    console.log(`  ${r.hash}`);
    p = await proposal(id);
    console.log(`  verdict=${p.verdict} confidence=${(await read("get_proposal_audit", [id])).match(/"confidence": (\d+)/)?.[1]}`);
  }
  if (p.verdict !== "COMPLIANT") return { error: `verdict is ${p.verdict}` };
  if (p.approvals === 0) {
    console.log(`\n[7] cast_vote ${id} so quorum is met`);
    const r = await write("cast_vote", [id, true]);
    if (!r.ok) return { error: `vote: ${r.reason}` };
    console.log(`  ${r.hash}`);
  }
  return { id };
}

/**
 * Let the fideicommis act on its own, up to `tries` cycles, and report whether
 * it paid anything. The model is free to keep choosing HOLD, and that is a
 * legitimate outcome, so this reports rather than asserts.
 */
async function autonomousCycle(label, tries = 3) {
  console.log(`\n${label}`);
  for (let i = 1; i <= tries; i += 1) {
    // The tick deadline is on chain and only ever moves forward, so wait it out
    // rather than discovering it from a rollback.
    if (i === 1) {
      console.log(`  waiting ${TICK + 15}s for the tick cooldown...`);
      await sleep((TICK + 15) * 1000);
    }
    const before = await summary();
    const r = await write("advance_cycle");
    if (!r.ok) {
      console.log(`  cycle ${i} rejected: ${r.reason.slice(0, 120)}`);
      return { acted: false, reason: r.reason };
    }
    const after = await summary();
    const moved = BigInt(after.treasury_atto) !== BigInt(before.treasury_atto);
    console.log(
      `  cycle ${i}: action=${after.last_action.padEnd(10)} executed ${before.executed_count}->${after.executed_count}  ` +
        `settled ${before.settled_count}->${after.settled_count}  treasury ${fmt(before.treasury_atto)}->${fmt(after.treasury_atto)}`,
    );
    if (moved) return { acted: true, action: after.last_action, summary: after, hash: r.hash };
    if (i < tries) {
      console.log(`    sleeping ${TICK + 15}s for the cooldown...`);
      await sleep((TICK + 15) * 1000);
    }
  }
  return { acted: false, reason: "stayed HOLD" };
}

async function main() {
  console.log(`keeper      : ${client.account.address}`);
  console.log(`beneficiary : ${BENEFICIARY}  (a non member, so payments leave the trust)`);
  console.log(`balance     : ${fmt(await balance())}`);
  await setup();
  await bootstrap();
  await fund();
  await policy();
  show("start", await summary());

  // The grant stages are skipped when the trust has already paid and settled one,
  // so a re-run after a rate-limit interruption goes straight to the amendment
  // instead of staging a second grant.
  // Skip the funding stage when a grant is already accepted but unsettled, so a
  // re-run after a rate-limit interruption settles it instead of staging a second
  // grant.
  let pendingSettlement = "";
  for (let n = 1; n <= Number((await summary()).proposal_count); n += 1) {
    const q = await proposal(`p${n}`).catch(() => null);
    if (q && q.kind === "GRANT" && q.delivery_verdict === "ACCEPTED" && !q.settled) pendingSettlement = `p${n}`;
  }
  const alreadyPaid = Number((await summary()).settled_count) > 0 || pendingSettlement !== "";
  if (pendingSettlement) {
    console.log(`\n[8-9] ${pendingSettlement} is already accepted and unpaid, going straight to settling it`);
    show("staged", await summary());
    const settle = await autonomousCycle("[10] the trust now has an accepted, unsettled delivery. Let it act.");
    step("autonomous SETTLE", settle.acted && settle.action === "SETTLE", settle.acted ? `paid via ${settle.action}` : settle.reason);
  } else if (alreadyPaid) {
    console.log("\n[8-10] a grant has already been funded and settled, skipping those stages");
  } else {
    const staged = await stageGrant();
    if (staged.error) {
      console.log(`\nSTOP: ${staged.error}`);
      return;
    }
    const id = staged.id;
    show("staged", await summary());

    // -------------------------------------------------------------- FUND
    const fund_ = await autonomousCycle("[8] the trust now has an approved, unpaid grant. Let it act.");
    step("autonomous FUND", fund_.acted && fund_.action === "FUND", fund_.acted ? `paid via ${fund_.action}` : fund_.reason);

    // ------------------------------------------------------------ SETTLE
    if (fund_.acted) {
      const p = await proposal(id);
      console.log(`  ${id}: executed=${p.executed}  recipient=${p.recipient}`);
      console.log(
        `  ${p.recipient.toLowerCase() === BENEFICIARY.toLowerCase() ? "money left the trust" : "UNEXPECTED recipient"}`,
      );
      if (p.delivery_verdict === "NONE") {
        console.log(`\n[9] review_delivery ${id} (left unsettled on purpose)`);
        const r = await write("review_delivery", [id, EVIDENCE]);
        if (!r.ok) console.log(`  FAILED at ${r.phase}: ${r.reason}`);
        else {
          console.log(`  ${r.hash}`);
          const q = await proposal(id);
          console.log(`  delivery=${q.delivery_verdict} score=${q.delivery_score} payout=${fmt(q.delivery_payout)}`);
        }
      }
      const settle = await autonomousCycle("[10] the trust now has an accepted, unsettled delivery. Let it act.");
      step("autonomous SETTLE", settle.acted && settle.action === "SETTLE", settle.acted ? `paid via ${settle.action}` : settle.reason);
    }
  }

  // --------------------------------------------------------------- AMEND
  const s = await summary();
  const amendId = `p${Number(s.proposal_count) + 1}`;
  let a = await proposal(amendId).catch(() => null);
  if (!a) {
    console.log(`\n[11] submit_proposal ${amendId} as a charter amendment`);
    const r = await write("submit_proposal", ["Charter amendment", NEW_CHARTER, "CHARTER_AMENDMENT", 0, ""]);
    if (!r.ok) return console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    console.log(`  ${r.hash}`);
    a = await proposal(amendId);
  }
  if (a.verdict === "PENDING") {
    const r = await write("assess_proposal", [amendId]);
    if (!r.ok) return console.log(`  assess FAILED at ${r.phase}: ${r.reason}`);
    console.log(`  assess  ${r.hash}`);
    a = await proposal(amendId);
    console.log(`  verdict=${a.verdict}`);
    if (a.verdict !== "COMPLIANT") {
      console.log("  the committee refused to change the charter, which is a legitimate outcome");
      return;
    }
  }
  if (a.approvals === 0) {
    const r = await write("cast_vote", [amendId, true]);
    if (!r.ok) return console.log(`  vote FAILED at ${r.phase}: ${r.reason}`);
    console.log(`  vote    ${r.hash}`);
  }
  const beforeVersion = Number((await summary()).charter_version);
  const r = await write("execute_proposal", [amendId]);
  if (!r.ok) return console.log(`  execute FAILED at ${r.phase}: ${r.reason}`);
  console.log(`  execute ${r.hash}`);
  const after = await summary();
  show("final", after);
  const charter = await read("get_charter");
  step("charter rewritten", after.charter_version === beforeVersion + 1, `version ${beforeVersion} -> ${after.charter_version}`);
  step("new rule present", charter.includes("yearly summary"), "");
  step("rulebook cleared", JSON.parse(await read("get_charter_rules")).length === 0, "");

  console.log("\n[12] mission log");
  for (const entry of JSON.parse(await read("get_mission_log", [0, 40]))) console.log(`  ${entry}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
