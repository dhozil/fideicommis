#!/usr/bin/env node
/**
 * Deploy a fresh Fideicommis whose member is a wallet this repository can sign for.
 *
 * Two findings led here, and both are about trust B (0xaEDf11fD), which was the only
 * deployment whose single member is an address the repository can drive:
 *
 *   1. It cannot answer two of its own views. `get_constitutional_state` and
 *      `get_constitution` both come back as an execution error, with the message
 *      "Every grant body must explicitly name the exact public URL intended to be kept
 *      reachable." That string is not in the current source, which places the deployment
 *      on an older build — and a contract that raises from a view method cannot be audited
 *      against itself, which for this project is most of what the reader is for.
 *   2. Studionet cannot upgrade a contract. There is no path from that build to this one,
 *      at that address or any other. It is permanently unreadable in those two views.
 *
 * The reference trust has the mirror problem: its member is an address whose key exists
 * nowhere in the repository, so its proposals rest at "assessed" and stay there.
 *
 * So the only configuration where the whole path — derive the rulebook, fund, propose,
 * judge, vote, wait out the delay, execute, review, settle — is reachable from here is a
 * new deployment from the current source, founded by a wallet this repository holds. That
 * is what this script does.
 *
 * The founder becomes the member by deployment rather than by any later call, because
 * `set_member_shares` reverts unconditionally: adding a member is only ever possible by
 * deploying one or by a governance proposal that an existing member has to approve. This
 * is the only route that needs no key this repository does not have.
 *
 * Run: node scripts/deploy_member_wallet.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STORE = process.env.WALLET_STORE || "D:/Genlayer-project/contract/.wallets/studionet.json";
const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));

const { makeDriver, fmt } = require("./studionet.cjs");

// The store's key carries no prefix and this SDK wants hex, so both forms are tried. The
// key is never printed.
function accountFrom(raw) {
  const body = String(raw).replace(/^0x/, "");
  for (const build of [
    () => createAccount(`0x${body}`),
    () => createAccount(Uint8Array.from(Buffer.from(body, "hex"))),
  ]) {
    try {
      return build();
    } catch {
      /* try the next form */
    }
  }
  throw new Error("no accepted form for the stored key");
}

const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
const account = accountFrom(store.private_key);

const client = createClient({ chain: chains.studionet, account });
const { writeTo, readFrom, balance } = makeDriver(client);

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "contracts", "fideicommis.py"),
  "utf-8",
);

const NAME = "Open Ledger Fund";
const MISSION =
  "Keep a public, independently verifiable record of every attoGEN this trust holds and every attoGEN it pays out.";

// A charter the work below actually satisfies, so a COMPLIANT verdict and a later
// ACCEPTED delivery are honest rather than staged. Rule 1 bounds a single grant, rule 2
// requires a nameable public source, and rule 4 requires evidence before a second tranche.
const CHARTER = [
  "This fideicommis publishes an auditable ledger of climate-adaptation reference material and nothing else.",
  "Rule 1: no single grant may exceed 10 percent of the treasury.",
  "Rule 2: every grant must name the exact public URL it is intended to keep reachable.",
  "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading.",
  "Rule 4: a second tranche is released only after delivered work is evidenced by a public source.",
  "Rule 5: changing any of these rules requires the same approval process as an ordinary grant.",
].join(" ");

const EVIDENCE = "https://en.wikipedia.org/wiki/Climate_change_adaptation";

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function confirmBrokenViews() {
  // Recorded rather than asserted in prose: the two views that fail are the reason for
  // deploying at all, and if a future node fixes the read the reason goes away.
  console.log("=== trust B, the reason for a new deployment ===");
  const B = fs.readFileSync(path.join(__dirname, "trust_b.address"), "utf-8").trim();
  for (const method of ["get_constitution", "get_constitutional_state", "get_org_summary"]) {
    try {
      await readFrom(B, method);
      line(method, "answers");
    } catch (err) {
      const message = String(err.cause?.data?.message ?? err.message).slice(0, 72);
      line(method, `REFUSES — ${message}`);
    }
  }
  console.log("");
}

(async () => {
  await confirmBrokenViews();

  const founder = client.account.address;
  console.log("=== the wallet that will be the member ===");
  line("address", founder);
  line("balance", fmt(await balance()));
  line("matches store", founder.toLowerCase() === String(store.address).toLowerCase());
  console.log("");

  console.log("=== deploying from the current source ===");
  line("source", "contracts/fideicommis.py");
  line("name", NAME);

  const deployed = await new Promise((resolve, reject) => {
    // deployContract lives in the driver only for the keeper client; this one is built
    // inline because the client carries a different account.
    (async () => {
      const hash = await client.deployContract({
        code: SOURCE,
        args: [NAME, MISSION, CHARTER, founder, EVIDENCE],
        consensusMaxRotations: 5,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        status: "ACCEPTED",
        interval: 4000,
        retries: 120,
      });
      const got = receipt?.transaction_hash ?? receipt?.transactionHash ?? receipt?.hash;
      if (got && String(got).toLowerCase() !== String(hash).toLowerCase()) {
        reject(new Error(`receipt is for another transaction: ${got} != ${hash}`));
        return;
      }
      const leader = receipt?.consensus_data?.leader_receipt?.[0];
      const status = leader?.result?.status;
      if (leader?.execution_result !== "SUCCESS" || (status && status !== "return")) {
        const payload = leader?.result?.payload;
        reject(
          new Error(
            `deployment failed: ${JSON.stringify(payload ?? leader?.error_code ?? "unknown").slice(0, 160)}`,
          ),
        );
        return;
      }
      resolve({ hash, address: receipt.contract_address || receipt.to_address });
    })().catch(reject);
  });

  line("tx", deployed.hash);
  line("address", deployed.address);

  const summary = JSON.parse(await readFrom(deployed.address, "get_org_summary"));
  const members = JSON.parse(await readFrom(deployed.address, "get_members"));
  line("name", summary.name);
  line("status", summary.status);
  line("charter version", summary.charter_version);
  line("founder is member", members[0]?.address === founder);
  line("shares", members[0]?.shares);
  console.log("");
  console.log("  Recorded where the other two live:");
  console.log(`    trust_c.address`);
  console.log(`    reader   /trust/${deployed.address}`);
  console.log(`    verify   /verify?address=${deployed.address}`);
})().catch((err) => {
  console.error("  fatal:", err.message ?? err);
  process.exit(1);
});