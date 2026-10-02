import { readFile } from "node:fs/promises";
import {
  EXPLORER_URL,
  addressOnExplorer,
  shortAddress,
  shortHash,
  txOnExplorer,
} from "../frontend/src/lib/explorer";

/**
 * The explorer links have to be right, because a link that 404s is worse than no
 * link: it looks like this project is making an unverifiable claim and then sending
 * you nowhere to check it.
 *
 * The routes were confirmed against the live site rather than assumed. Both of the
 * plausible alternatives 404 there, which is the kind of thing that passes every local
 * test and is wrong in production.
 *
 *     /tx/<hash>         200
 *     /address/<hash>    200
 *     /transaction/...   404
 *     /account/...       404
 */

let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

console.log("=== the base is the Studionet explorer ===");
check("host is explorer-studio.genlayer.com", EXPLORER_URL === "https://explorer-studio.genlayer.com", EXPLORER_URL);
check("https, and no trailing slash", EXPLORER_URL.startsWith("https://") && !EXPLORER_URL.endsWith("/"));

console.log();
console.log("=== the two routes the reader uses ===");
const ADDRESS = "0x76051A36dCB316bD7Bf272692B3e3f7930170597";
const HASH = "0x" + "ab".repeat(32);

const addressLink = addressOnExplorer(ADDRESS);
const txLink = txOnExplorer(HASH);

check("address link", addressLink === `${EXPLORER_URL}/address/${ADDRESS}`, addressLink);
check("tx link", txLink === `${EXPLORER_URL}/tx/${HASH}`, txLink);
check("no etherscan-shaped /transaction/", !addressLink.includes("/transaction/"));
check("no /account/ route", !txLink.includes("/account/"));

console.log();
console.log("=== truncation is marked, not silently shortened ===");
check("short hash keeps both ends", shortHash(HASH) === "0xabababab…ababab", shortHash(HASH));
check("short hash uses an ellipsis", shortHash(HASH).includes("…"));
// Defaults are lead 8 and tail 6. Writing the expected string out by hand got it
// wrong twice, so it is derived from the same slices the function uses.
check(
  "short address",
  shortAddress(ADDRESS) === `${ADDRESS.slice(0, 8)}…${ADDRESS.slice(-6)}`,
  shortAddress(ADDRESS),
);
check("a short value is left alone", shortHash("0xabc") === "0xabc", shortHash("0xabc"));
check("never cuts below the lead", shortHash(HASH, 10).length > 10);

console.log();
console.log("=== the wallet is handed the same explorer ===");
const wallet = await readFile("frontend/src/lib/wallet.ts", "utf-8");
check("wallet imports EXPLORER_URL", wallet.includes('from "./explorer"'));
check(
  "wallet defaults to it, not to an empty list",
  wallet.includes("blockExplorerUrls: [EXPLORER_URL]"),
);
// The variable may still be named in a comment explaining why it is no longer read,
// and this comment does exactly that. So the check looks at code lines only, because
// searching the whole file matches the comment's own explanation of the old code.
const walletCode = wallet
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");
check(
  "no env-var default is still read in code",
  !walletCode.includes("NEXT_PUBLIC_EXPLORER_URL"),
);

console.log();
console.log(failed ? `${failed} check(s) failed` : "every explorer link is correct");
if (failed) process.exit(1);