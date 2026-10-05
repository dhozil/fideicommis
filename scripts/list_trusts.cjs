#!/usr/bin/env node
/**
 * Every trust this repository knows about, and its state right now.
 *
 * There is no registry on chain — that was removed along with the factory, because a
 * directory of live trusts is worth keeping and on-chain state owned by one address is
 * not. So the list is a file in this repo, and this reads each address live rather than
 * repeating the file. If an address is stale or wrong, the numbers say so.
 *
 * The address a reader opens by hand is any of these, and any Fideicommis anyone has
 * deployed — the form does not require permission from this site.
 *
 * Run: node scripts/list_trusts.cjs
 */

const fs = require("fs");
const path = require("path");
const { makeClient, makeDriver, fmt } = require("./studionet.cjs");

const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom, balance } = makeDriver(client);

const file = (name) => {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : null;
};

const KNOWN = [
  ["trust.address", file("trust.address"), "reference trust, from scripts/"],
  ["trust_b.address", file("trust_b.address"), "second deployment, from scripts/"],
  ["registry.ts", "0x89D3E2F937a265583BF308F2d5250445e1f7113F", "listed in the reader's directory"],
];

(async () => {
  console.log(`  caller ${client.account.address}  balance ${fmt(await balance())}\n`);

  for (const [source, address, note] of KNOWN) {
    if (!address) {
      console.log(`  ${source}: no address recorded`);
      continue;
    }
    let s;
    try {
      s = JSON.parse(await readFrom(address, "get_org_summary"));
    } catch (err) {
      console.log(`  ${address}\n    unreadable: ${String(err.message).slice(0, 70)}`);
      continue;
    }

    let rules = "unreadable";
    let members = "unreadable";
    try {
      rules = String(JSON.parse(await readFrom(address, "get_charter_rules")).length);
      members = JSON.parse(await readFrom(address, "get_members"))
        .map((m) => `${m.address.slice(0, 8)}… ${m.shares}`)
        .join("  ");
    } catch {
      /* left as unreadable */
    }

    console.log(`  ${address}`);
    console.log(`    name            ${s.name}`);
    console.log(`    via             ${source} — ${note}`);
    console.log(`    status          ${s.status}   cycle ${s.cycle}   last ${s.last_action}`);
    console.log(`    treasury        ${fmt(s.treasury_atto)}`);
    console.log(`    runway          ${s.runway_cycles} cycles`);
    console.log(`    rules derived   ${rules}`);
    console.log(`    proposals       ${s.proposal_count}  executed ${s.executed_count}  settled ${s.settled_count}`);
    console.log(`    members         ${members}`);
    console.log(`    reader          /trust/${address}`);
    console.log(`    verify          /verify?address=${address}`);
    console.log("");
  }
})();