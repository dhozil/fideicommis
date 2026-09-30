#!/usr/bin/env node
/**
 * Verifies the proposal, delivery and rejection paths on Studionet.
 *
 * Phase A runs against an existing fideicommis and asserts that a proposal
 * violating its charter is rejected, so it can never be voted on or paid out.
 *
 * Phase B deploys a fideicommis whose charter actually covers the fixture
 * deliverable, then walks the whole money path:
 *   submit -> assess (real LLM) -> vote -> execute -> review delivery
 *   (real LLM + real web fetch) -> settle -> advance_cycle
 *
 * Resumable: each step reads on-chain state first, so a rate-limit interruption
 * can be resumed by re-running.
 *
 * Setup, once:
 *   genlayer account send <keeper> 0.5gen
 *   and put the keeper key at scripts/orgkeeper.key (gitignored)
 *
 * Usage:
 *   node scripts/run_proposal_flow.cjs            # both phases
 *   node scripts/run_proposal_flow.cjs b --redeploy
 *   node scripts/run_proposal_flow.cjs a
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, fmt } = require("./studionet.cjs");

const HERE = __dirname;
const client = makeClient(path.join(HERE, process.env.FIDE_KEY_FILE || "orgkeeper.key"));
const { readFrom, writeTo, deployContract, balance } = makeDriver(client);

const A_FILE = path.join(HERE, "trust.address");
const B_FILE = path.join(HERE, "trust_b.address");

// A real, openly reachable page that actually is climate-adaptation reference
// material. Two earlier attempts used https://example.org/ and the committee
// rejected both, correctly: the judge fetched the page, recognised it as a
// documentation placeholder, and cited the mismatch with the mission.
// A placeholder is not evidence of anything, which is the system working.
const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";

const CHARTER_A = [
  "This fideicommis exists to fund open source climate adaptation research and nothing else.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: a grantee must have a public and verifiable repository before any funds are released.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: delivered work must be evidenced by a public source before a second tranche is released.",
  "Rule 5: changing any of these rules requires the same approval process as an ordinary grant.",
].join(" ");

// A charter the fixture deliverable genuinely satisfies, so a COMPLIANT verdict
// and a later ACCEPTED delivery are honest rather than staged.
const MISSION_B = "Keep public climate-adaptation reference material continuously reachable.";
const CHARTER_B = [
  "This fideicommis maintains a public archive of climate-adaptation reference material.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: every grant must be to keep a public web page reachable, and the grant body must name the exact public URL to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: changing any of these rules requires the same approval process as an ordinary grant.",
].join(" ");

const GRANT = 2n * 10n ** 16n; // 0.02 GEN, under the 20 percent ceiling
const FUND = 30n * 10n ** 16n;
const TICK = 60;

const GRANT_TITLE = "Keep the named public page reachable";
const GRANT_BODY =
  `The work commissioned is to keep this public web page reachable: ${EVIDENCE} `
  + "The page is an open encyclopedia article on climate change adaptation. "
  + "The deliverable is that a member of the public can open that exact URL and read the article, "
  + "without an account, a paywall, or a login, and that it keeps returning that content. "
  + "The requested amount covers the ongoing hosting and upkeep of that page.";

function show(label, s) {
  console.log(
    `  ${label.padEnd(24)} status=${String(s.status).padEnd(9)} cycle=${String(s.cycle).padEnd(3)} ` +
      `treasury=${fmt(s.treasury_atto).padEnd(16)} proposals=${s.proposal_count} ` +
      `executed=${s.executed_count} settled=${s.settled_count}`,
  );
}

async function orgB() {
  if (fs.existsSync(B_FILE) && !process.argv.includes("--redeploy")) {
    return fs.readFileSync(B_FILE, "utf-8").trim();
  }
  console.log("\n[B0] deploying fideicommis B");
  const d = await deployContract(fs.readFileSync(path.join(__dirname, "..", "contracts", "fideicommis.py"), "utf-8"), [
    "Open Reference Fund",
    MISSION_B,
    CHARTER_B,
    client.account.address,
    EVIDENCE,
  ]);
  if (!d.ok) {
    console.log(`  FAILED at ${d.phase}: ${d.reason}`);
    process.exit(1);
  }
  console.log(`  ${d.hash}\n  address ${d.address}`);
  fs.writeFileSync(B_FILE, d.address, "utf-8");
  return d.address;
}

async function phaseA() {
  const A = fs.readFileSync(A_FILE, "utf-8").trim();
  console.log(`\n=== PHASE A: rejection path on ${A} ===`);
  const read = (m, args = []) => readFrom(A, m, args);
  const write = (m, args = []) => writeTo(A, m, args);
  const summary = () => read("get_org_summary").then(JSON.parse);
  const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);
  const audit = (id) => read("get_proposal_audit", [id]).then(JSON.parse);

  let s = await summary();
  show("start", s);
  if (s.status !== "ACTIVE") {
    console.log(`  fideicommis is ${s.status}, fund it before running phase A`);
    return;
  }

  const id = `p${Number(s.proposal_count) + 1}`;
  let p = await proposal(id).catch(() => null);
  if (!p) {
    console.log("\n[A1] submit_proposal for surveillance tooling");
    const r = await write("submit_proposal", [
      "Grant for a national-scale surveillance network",
      "Build and operate a country-wide citizens movement tracking system using facial recognition at every transit hub.",
      "GRANT",
      GRANT,
      client.account.address,
    ]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }
  console.log(`  ${id}: ${p.verdict}  amount=${fmt(p.amount_atto)}  violations=${JSON.stringify(p.violations)}`);

  if (p.verdict === "PENDING") {
    console.log("\n[A2] assess_proposal (real LLM, committee must agree)");
    const r = await write("assess_proposal", [id]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
    console.log(`  verdict=${p.verdict}  violations=${JSON.stringify(p.violations)}`);
    console.log(`  audit: ${await audit(id)}`);
  }

  console.log("\n[A3] the verdict must block voting and payment");
  const vote = await write("cast_vote", [id, true]);
  const exec = await write("execute_proposal", [id]);
  console.log(`  cast_vote        ${vote.ok ? "ACCEPTED (BAD)" : `blocked: ${vote.reason.slice(0, 110)}`}`);
  console.log(`  execute_proposal ${exec.ok ? "ACCEPTED (BAD)" : `blocked: ${exec.reason.slice(0, 110)}`}`);
  show("after", await summary());
}

async function phaseB() {
  console.log("\n=== PHASE B: full money path ===");
  const B = await orgB();
  const read = (m, args = []) => readFrom(B, m, args);
  const write = (m, args = [], v = 0n) => writeTo(B, m, args, v);
  const summary = () => read("get_org_summary").then(JSON.parse);
  const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);
  const audit = (id) => read("get_proposal_audit", [id]).then(JSON.parse);

  show("start", await summary());

  if (Number((await summary()).charter_rule_count) === 0) {
    console.log("\n[B1] bootstrap_rules");
    const r = await write("bootstrap_rules");
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    for (const rule of JSON.parse(await read("get_charter_rules"))) console.log(`    ${rule.id}: ${rule.text}`);
  }

  if (Number((await summary()).treasury_atto) === 0) {
    console.log("\n[B2] fund()");
    const r = await write("fund", [], FUND);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    show("after fund", await summary());
  }

  const policy = JSON.parse(await read("get_policy"));
  if (policy.tick_interval !== TICK || policy.burn_per_cycle !== 0) {
    console.log("\n[B3] set_policy (no burn, so the money path is the only thing moving)");
    const r = await write("set_policy", [0n, 0n, TICK]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
  }

  const before = await summary();
  const id = `p${Number(before.proposal_count) + 1}`;
  let p = await proposal(id).catch(() => null);

  if (!p) {
    console.log(`\n[B4] submit_proposal ${id}`);
    const r = await write("submit_proposal", [GRANT_TITLE, GRANT_BODY, "GRANT", GRANT, client.account.address]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }

  if (p.verdict === "PENDING") {
    console.log(`\n[B5] assess_proposal ${id} (real LLM)`);
    const r = await write("assess_proposal", [id]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }
  console.log(`  verdict=${p.verdict}  violations=${JSON.stringify(p.violations)}`);
  console.log(`  audit: ${await audit(id)}`);
  if (p.verdict !== "COMPLIANT") {
    console.log("  not compliant, the money path stops here (a valid outcome)");
    return;
  }

  if (p.approvals === 0) {
    console.log("\n[B6] cast_vote + execute_proposal");
    let r = await write("cast_vote", [id, true]);
    if (!r.ok) {
      console.log(`  cast_vote FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  vote   ${r.hash}`);
    r = await write("execute_proposal", [id]);
    if (!r.ok) {
      console.log(`  execute FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  exec   ${r.hash}`);
    p = await proposal(id);
  }
  show("after execute", await summary());
  console.log(`  ${id}: executed=${p.executed}`);

  if (p.delivery_verdict === "NONE") {
    console.log(`\n[B7] review_delivery (real LLM + real fetch of ${EVIDENCE})`);
    const r = await write("review_delivery", [id, EVIDENCE]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }
  console.log(`  delivery=${p.delivery_verdict} score=${p.delivery_score} payout=${fmt(p.delivery_payout)}`);

  if (p.delivery_verdict === "ACCEPTED" && !p.settled) {
    console.log("\n[B8] settle_delivery");
    const r = await write("settle_delivery", [id]);
    if (!r.ok) {
      console.log(`  FAILED at ${r.phase}: ${r.reason}`);
      return;
    }
    console.log(`  ${r.hash}`);
    p = await proposal(id);
  }
  show("after settle", await summary());
  console.log(`  ${id}: settled=${p.settled}  treasury moved from ${fmt(before.treasury_atto)}`);

  console.log("\n[B9] advance_cycle: does it act on its own?");
  const pre = await summary();
  const r = await write("advance_cycle");
  if (!r.ok) {
    console.log(`  FAILED at ${r.phase}: ${r.reason}`);
    return;
  }
  console.log(`  ${r.hash}`);
  const post = await summary();
  show("after advance_cycle", post);
  console.log(
    `  last_action=${post.last_action}  executed ${pre.executed_count}->${post.executed_count}  ` +
      `settled ${pre.settled_count}->${post.settled_count}`,
  );

  console.log("\n[B10] mission log");
  for (const entry of JSON.parse(await read("get_mission_log", [0, 40]))) console.log(`  ${entry}`);
}

async function main() {
  const only = process.argv.filter((a) => ["a", "b"].includes(a.toLowerCase())).map((a) => a.toLowerCase());
  const runA = only.length === 0 || only.includes("a");
  const runB = only.length === 0 || only.includes("b");
  console.log(`keeper : ${client.account.address}`);
  console.log(`phases : ${[runA && "A", runB && "B"].filter(Boolean).join("+")}`);
  console.log(`balance: ${fmt(await balance())}`);
  if (runA && fs.existsSync(A_FILE)) await phaseA();
  if (runB) await phaseB();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
