#!/usr/bin/env node
/**
 * The state of trust B's proposals, and whether any of them can still be finished.
 *
 * Trust B is the only deployment whose single member is an address this repository can
 * sign for, so it is the only place where `cast_vote` and `execute_proposal` are reachable
 * at all. Both other known trusts have a member whose key exists nowhere in the repository,
 * so anything submitted to them rests at "assessed" and stays there.
 *
 * The point of this script is to find out which proposal is unfinished rather than to
 * assume, because the three of them are in different states: one is settled, and what the
 * other two are doing determines whether there is anything left to do here.
 *
 * Run: node scripts/trust_b_state.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, fmt } = require("./studionet.cjs");

const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom } = makeDriver(client);

const TRUST = fs.readFileSync(path.join(__dirname, "trust_b.address"), "utf-8").trim();
const read = (m, args = []) => readFrom(TRUST, m, args);

(async () => {
  console.log(`  trust B ${TRUST}`);
  console.log(`  caller ${client.account.address}\n`);

  const state = JSON.parse(await read("get_constitutional_state"));
  console.log(`  quorum            ${state.quorum_bps} bps`);
  console.log(`  amendment delay   ${state.amendment_delay}s (${state.amendment_delay / 3600}h)`);
  console.log(`  total shares      ${state.total_shares}`);

  const members = JSON.parse(await read("get_members"));
  const isMember = members.some(
    (m) => String(m.address).toLowerCase() === client.account.address.toLowerCase(),
  );
  console.log(`  caller is member  ${isMember ? "yes" : "no"}`);
  console.log("");

  const ids = JSON.parse(await read("get_proposal_ids"));
  console.log(`  proposals: ${ids.join(", ")}\n`);

  let finishable = 0;
  for (const id of ids) {
    const p = await read("get_proposal", [id]).then(JSON.parse).catch(() => null);
    if (!p) {
      console.log(`  ${id}  unreadable`);
      continue;
    }
    console.log(`  ${id}  verdict=${p.verdict}  kind=${p.kind}`);
    console.log(`      approvals=${p.approvals} rejections=${p.rejections}`);
    console.log(`      executed=${p.executed}  settled=${p.settled}`);
    console.log(`      delivery=${p.delivery_verdict}  score=${p.delivery_score}`);
    console.log(`      amount=${fmt(p.amount_atto)}  recipient=${p.recipient}`);

    const state_ = p.settled
      ? "settled — nothing to do"
      : p.executed
        ? `executed, awaiting review_delivery (delivery=${p.delivery_verdict})`
        : p.verdict === "COMPLIANT" && Number(p.approvals) === 0 && isMember
          ? "COMPLIANT and unvoted — a vote is available"
          : p.verdict === "COMPLIANT"
            ? "COMPLIANT but unvoted — only a member may vote"
            : `${p.verdict} — cannot be voted on or paid`;
    console.log(`      => ${state_}`);
    if (state_.startsWith("COMPLIANT and unvoted") || state_.startsWith("executed, awaiting")) {
      finishable += 1;
    }
    console.log("");
  }

  console.log(`  ${finishable} of ${ids.length} proposals still have work available to this account.`);
})();