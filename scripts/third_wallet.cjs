#!/usr/bin/env node
/**
 * What the third wallet is, without printing its key.
 *
 * The wallet at D:\Genlayer-project\contract\.wallets\studionet.json turned out to be a
 * third address — not the keeper this repo drives with, and not the single member of the
 * trust on Studionet. So it cannot vote anywhere that matters, and the question becomes
 * whether it can afford to be the founder of a new deployment instead.
 *
 * Two details cost a couple of attempts and are recorded here so the next person does not
 * repeat them:
 *
 *   - the stored key carries a `0x` prefix, and `createAccount` rejects that with "invalid
 *     private key, expected hex or 32 bytes, got string". Strip it.
 *   - nothing in this file prints the key. The store is a secret on someone's disk; echoing
 *     it into a terminal puts it in scrollback and in whatever captures the session.
 *
 * Run: node scripts/third_wallet.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STORE = process.env.WALLET_STORE || "D:/Genlayer-project/contract/.wallets/studionet.json";
const GLOBAL = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL, "genlayer-js"));

const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));

/**
 * The stored key is 64 hex characters with no `0x` prefix, and it is a valid key —
 * 32 bytes, below the curve order, not zero. So the two rejections were about how the
 * value is handed over rather than about the value:
 *
 *   - bare hex   -> "invalid private key, expected hex or 32 bytes, got string"
 *   - as bytes   -> accepted, which is what viem's own docs call the 32-byte form
 *
 * Both are tried, in that order, because which one this build wants is a property of the
 * installed SDK rather than of the file.
 */
function accountFrom(raw) {
  const body = String(raw).replace(/^0x/, "");
  const attempts = [
    ["0x-prefixed hex", () => createAccount(`0x${body}`)],
    ["32 raw bytes", () => createAccount(Uint8Array.from(Buffer.from(body, "hex")))],
  ];
  const tried = [];
  for (const [label, build] of attempts) {
    try {
      return { account: build(), how: label };
    } catch (err) {
      tried.push(`${label}: ${String(err.message).slice(0, 60)}`);
    }
  }
  throw new Error(`no accepted form for the stored key\n    ${tried.join("\n    ")}`);
}

const { account, how } = accountFrom(store.private_key);
const client = createClient({ chain: chains.studionet, account });

async function main() {
  console.log(`  store          ${path.basename(STORE)} (${fs.statSync(STORE).size} bytes)`);
  console.log(`  network        ${store.network}  chain ${store.chain_id}`);
  console.log(`  key accepted as ${how}`);
  console.log(`  address        ${client.account.address}`);
  console.log(
    `  derived matches the stored address: ${
      client.account.address.toLowerCase() === String(store.address).toLowerCase()
    }`,
  );

  try {
    const raw = await client.getBalance({ address: client.account.address });
    console.log(`  balance        ${(Number(BigInt(raw)) / 1e18).toFixed(6)} GEN`);
  } catch (err) {
    console.log(`  balance        unavailable: ${String(err.message).slice(0, 70)}`);
  }

  // The question that decides whether this wallet is useful: is it the member of either
  // trust this repo knows about? A founder can be made a member by deployment, which is the
  // only route — `set_member_shares` reverts unconditionally.
  const trustA = fs.readFileSync(path.join(__dirname, "trust.address"), "utf-8").trim();
  const trustB = fs.readFileSync(path.join(__dirname, "trust_b.address"), "utf-8").trim();
  console.log("");
  for (const [label, address] of [["trust A", trustA], ["trust B", trustB]]) {
    try {
      const members = JSON.parse(
        await client.readContract({ address, functionName: "get_members", args: [] }),
      );
      const holds = members.some(
        (m) => String(m.address).toLowerCase() === client.account.address.toLowerCase(),
      );
      console.log(`  member of ${label} ${address.slice(0, 10)}...: ${holds ? "yes" : "no"}`);
    } catch (err) {
      console.log(`  member of ${label}: unreadable (${String(err.message).slice(0, 40)})`);
    }
  }
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(1);
});