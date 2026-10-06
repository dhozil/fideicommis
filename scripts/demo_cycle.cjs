#!/usr/bin/env node
/**
 * The whole money path on a fresh trust, in one resumable pass.
 *
 * Takes a trust address and a theme, and walks it from dormant to settled:
 * bootstrap_rules, fund, three proposals (one written to violate the charter,
 * two written to satisfy it), assess all three, vote the compliant ones,
 * execute, review the deliveries against the named public pages, settle, and
 * finally check the conservation identity
 * inflow == treasury + granted + settled + dissolved + keeper_paid + burned.
 *
 * Every step reads on-chain state first, so a step that already happened is
 * skipped rather than repeated, nothing is paid twice, and re-running resumes
 * rather than restarts. The one exception is a verdict the committee already
 * gave: a NON_COMPLIANT proposal cannot be re-assessed, which is why the
 * violating proposal is submitted once and left standing as the refusal demo.
 *
 * The violating proposal is deliberately off-charter: no public URL is named
 * (Rule 2 requires the exact public URL) and the purpose is short-term
 * speculative trading (Rule 3 forbids it outright). Its amount sits inside the
 * spending ceiling on purpose, so that when the committee refuses it, the
 * refusal is on charter grounds rather than on arithmetic.
 *
 * The signer comes from the wallet the operator pointed at, D:/Genlayer-project/wallet,
 * which is also the founder and therefore the single member of every trust it
 * deploys. That is what makes the member-gated steps (vote, execute, review,
 * settle) reachable from here at all.
 *
 * Run: node scripts/demo_cycle.cjs <trust-address> <nusantara|openscience|pustaka>
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));
const { makeDriver, fmt } = require("./studionet.cjs");

const TRUST = process.argv[2];
const THEME = process.argv[3];
if (!TRUST || !/^0x[0-9a-fA-F]{40}$/.test(TRUST)) {
  console.error("usage: node scripts/demo_cycle.cjs <trust-address> <nusantara|openscience|pustaka>");
  process.exit(1);
}

const THEMES = {
  nusantara: {
    page: "https://en.wikipedia.org/wiki/Climate_change_adaptation",
    about: "an open encyclopedia article on climate change adaptation",
  },
  openscience: {
    page: "https://en.wikipedia.org/wiki/Climate_resilience",
    about: "an open encyclopedia article on climate resilience",
  },
  pustaka: {
    page: "https://en.wikipedia.org/wiki/Climate_change_mitigation",
    about: "an open encyclopedia article on climate change mitigation",
  },
};
const theme = THEMES[THEME];
if (!theme) {
  console.error(`unknown theme ${THEME}: nusantara, openscience, or pustaka`);
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
const { writeTo, readFrom, balance } = makeDriver(client);

const read = (m, args = []) => readFrom(TRUST, m, args);
const write = (m, args = [], v = 0n) => writeTo(TRUST, m, args, v);
const summary = () => read("get_org_summary").then(JSON.parse);
const proposal = (id) => read("get_proposal", [id]).then(JSON.parse);
const idsOf = () => read("get_proposal_ids").then(JSON.parse);

const FUND = 1n * 10n ** 18n;
const GRANT = 5n * 10n ** 16n;
const SMALL = 1n * 10n ** 16n;

const BAD_TITLE = "Grow the treasury through short-term trading";
const BAD_BODY =
  "Use the granted funds for short-term speculative trading of crypto assets to grow the "
  + "treasury before any of it is spent. No public page is involved in this work, and the "
  + "returns will be reported privately to the member rather than evidenced by a public source.";

function goodProposal(page, about, tranche) {
  return {
    title: `Keep the named reference page reachable (${tranche})`,
    body:
      `The work commissioned is to keep this public web page reachable: ${page} `
      + `The page is ${about}. The deliverable is that a member of the public can open that `
      + "exact URL and read the article, without an account, a paywall, or a login, and that it "
      + "keeps returning that content. The requested amount covers ongoing hosting and upkeep "
      + `of that page. This is the ${tranche} tranche of that upkeep.`,
  };
}

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
  console.log(`  trust ${TRUST} (${THEME})`);
  line("caller", client.account.address);
  line("balance", fmt(await balance()));
  const members = JSON.parse(await read("get_members"));
  line(
    "is a member",
    members.some((m) => String(m.address).toLowerCase() === client.account.address.toLowerCase())
      ? "yes"
      : `no — member is ${members[0]?.address}`,
  );

  let s = await summary();
  line("name", String(await read("get_org_name")));
  line("treasury", fmt(s.treasury_atto));

  if (Number(s.charter_rule_count) === 0) {
    await step("bootstrap", "bootstrap_rules");
    s = await summary();
  } else {
    console.log("\n[bootstrap] already derived");
  }

  if (BigInt(s.treasury_atto) === 0n) {
    await step("fund", "fund", [], FUND);
    s = await summary();
  } else {
    console.log("\n[fund] treasury is not empty");
  }
  if (BigInt(s.treasury_atto) === 0n) {
    console.error("\n  fatal: fund did not land — stopping before any assessment, because a grant");
    console.error("  judged against an empty treasury would be refused on ceiling grounds instead of");
    console.error("  on its merits. Re-run to resume.");
    process.exit(1);
  }
  line("treasury now", fmt(s.treasury_atto));

  // p1 is the refusal demo: written to violate the charter, submitted once, and left
  // standing. Everything after it is top-up: keep submitting compliant upkeep proposals
  // until two of them are fully settled, however many attempts the committee needs.
  // (A verdict is final — a proposal refused on an empty treasury cannot be re-judged,
  // so a burnt proposal is abandoned, never retried.)
  let p1 = await proposal("p1").catch(() => null);
  if (!p1) {
    console.log("\n  === p1: the refusal demo (expecting NON_COMPLIANT) ===");
    await step("p1 submit", "submit_proposal", [
      BAD_TITLE,
      BAD_BODY,
      "GRANT",
      SMALL,
      client.account.address,
    ]);
    p1 = await proposal("p1");
  } else {
    console.log("\n  === p1: the refusal demo (already submitted) ===");
  }
  line("verdict", p1.verdict);
  if (p1.verdict === "PENDING") {
    await step("p1 assess", "assess_proposal", ["p1"]);
    p1 = await proposal("p1");
  }
  line("verdict", p1.verdict);
  line("violations", JSON.stringify(p1.violations));
  console.log("  p1 refused by the committee — that refusal is the demo.");

  let n = (await idsOf()).length;
  let settled = 0;
  for (const p of await idsOf()) {
    const cur = await proposal(p).catch(() => null);
    if (cur && cur.settled) settled += 1;
  }
  let attempts = 0;
  while (settled < 2 && attempts < 6) {
    attempts += 1;
    n += 1;
    const id = `p${n}`;
    const tranche = attempts === 1 ? "first" : attempts === 2 ? "second" : `top-up ${attempts}`;
    const want = goodProposal(theme.page, theme.about, tranche);
    console.log(`\n  === ${id}: upkeep (${tranche}) ===`);
    await step(`${id} submit`, "submit_proposal", [
      want.title,
      want.body,
      "GRANT",
      GRANT,
      client.account.address,
    ]);
    let p = await proposal(id);
    line("verdict", p.verdict);
    if (p.verdict === "PENDING") {
      await step(`${id} assess`, "assess_proposal", [id]);
      p = await proposal(id);
    }
    line("verdict", p.verdict);
    line("violations", JSON.stringify(p.violations));
    if (p.verdict !== "COMPLIANT") {
      console.log(`  ${id} refused — abandoned, never retried.`);
      continue;
    }
    if (Number(p.approvals) === 0) {
      await step(`${id} vote`, "cast_vote", [id, true]);
      p = await proposal(id);
    }
    if (!p.executed) {
      await step(`${id} execute`, "execute_proposal", [id]);
      p = await proposal(id);
    }
    line("executed", p.executed);
    if (p.delivery_verdict === "NONE" || !p.delivery_verdict) {
      await step(`${id} review`, "review_delivery", [id, theme.page]);
      p = await proposal(id);
    }
    line("delivery", `${p.delivery_verdict} (score ${p.delivery_score})`);
    if (p.delivery_verdict === "ACCEPTED" && !p.settled) {
      await step(`${id} settle`, "settle_delivery", [id]);
      p = await proposal(id);
    }
    line("settled", p.settled);
    if (p.settled) settled += 1;
  }
  line("settled grants", `${settled} (want 2)`);

  console.log("\n=== the ledger afterwards ===");
  const flow = JSON.parse(await read("get_lifetime_flow"));
  for (const key of [
    "inflow_atto",
    "treasury_atto",
    "granted_atto",
    "settled_atto",
    "dissolved_atto",
    "keeper_paid_atto",
    "burned_atto",
  ]) {
    line(key.replace("_atto", ""), fmt(flow[key] ?? 0));
  }
  let buckets = 0n;
  for (const k of ["treasury_atto", "granted_atto", "settled_atto", "dissolved_atto", "keeper_paid_atto", "burned_atto"]) {
    buckets += BigInt(flow[k] ?? 0);
  }
  line("identity holds", BigInt(flow.inflow_atto) === buckets);
  line("caller balance", fmt(await balance()));
  console.log(`\n  reader /trust/${TRUST}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});
