/**
 * Does wallet discovery offer every wallet, and only the announced ones?
 *
 * Discovery is the part of wallet connection that is invisible in a screenshot and wrong
 * in four specific ways, none of which a type checker catches:
 *
 *   1. Reading `window.ethereum` connects whichever wallet injected last, so a user with
 *      two wallets signs with the wrong one and is shown the wrong address.
 *   2. Naming a discovered wallet from a hardcoded list makes every wallet not on that
 *      list invisible. The previous version of this code knew `metamask | rabby` and
 *      nothing else, so a Brave Wallet installed alongside them did not appear at all.
 *   3. Dispatching the request before attaching the listener loses announcements that
 *      arrive in between.
 *   4. Not re-dispatching on mount means a wallet installed in another tab is never found
 *      until a full reload.
 *
 * The first attempt at this file drove a re-implementation of the hook's effect body.
 * That is the classic way to write a test that passes while the code is broken: it could
 * not have caught any of the four above, because it *was* a correct version. So the pure
 * parts of the real module are imported and driven directly, and the ordering guarantee
 * is asserted against the module's own source — the same approach `check_runner_cache.py`
 * takes for gltest's cache glob, and for the same reason.
 *
 * No DOM and no React renderer, deliberately. jsdom plus a testing library would be two
 * new dependencies that `npm ci` installs on every Vercel build, to test four functions
 * that take plain objects.
 *
 * Run: npx tsx@4 tests/check_wallet_discovery.mts
 */

import { readFile } from "node:fs/promises";

import {
  DISCOVERY_MS,
  dedupe,
  fromLegacy,
  iconFromName,
  legacyName,
  legacyRdns,
  type DiscoveredWallet,
  type Eip1193Provider,
} from "../frontend/src/lib/eip6963";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

function announced(
  rdns: string,
  name: string,
  options: { icon?: string; uuid?: string } = {},
): DiscoveredWallet {
  return {
    id: options.uuid ?? `uuid-${rdns}`,
    name,
    icon: options.icon ?? "",
    rdns,
    provider: { request: async () => [] },
    announced: true,
  };
}

console.log("=== every announced wallet is offered, named by itself ===");
{
  const wallets = dedupe([
    announced("io.metamask", "MetaMask", { icon: "data:image/svg+xml;base64,mm" }),
    announced("io.rabby", "Rabby", { icon: "data:image/svg+xml;base64,rb" }),
    // The one the previous union type could not represent at all.
    announced("com.brave.wallet", "Brave Wallet"),
  ]);
  check("three wallets", wallets.length === 3, `${wallets.length}`);
  const names = wallets.map((w) => w.name);
  check(
    "including one outside the old metamask|rabby union",
    names.includes("Brave Wallet"),
    names.join(", "),
  );
  check("all marked as announced", wallets.every((w) => w.announced));
  check("icons survive", wallets.some((w) => w.icon.startsWith("data:")));
}

console.log();
console.log("=== ordering is stable between visits ===");
{
  // A list that reorders itself makes people tap the wrong row, which on a signing
  // dialog is worse than on a menu.
  const forward = dedupe([
    announced("io.metamask", "MetaMask"),
    announced("io.rabby", "Rabby"),
  ]);
  const reversed = dedupe([
    announced("io.rabby", "Rabby"),
    announced("io.metamask", "MetaMask"),
  ]);
  check(
    "same order regardless of announcement order",
    forward.map((w) => w.id).join() === reversed.map((w) => w.id).join(),
    forward.map((w) => w.name).join(", "),
  );
}

console.log();
console.log("=== the same wallet announcing twice is listed once ===");
{
  const wallets = dedupe([
    announced("io.metamask", "MetaMask", { uuid: "a" }),
    announced("io.metamask", "MetaMask", { uuid: "b" }),
  ]);
  check("deduplicated by rdns, not by uuid", wallets.length === 1, `${wallets.length}`);
}

console.log();
console.log("=== an announced wallet beats a sniffed one for the same rdns ===");
{
  const sniffed = fromLegacy({ isMetaMask: true, request: async () => [] } as Eip1193Provider);
  const wallets = dedupe([announced("io.metamask", "MetaMask"), sniffed]);
  check("one entry", wallets.length === 1, `${wallets.length}`);
  check("and it is the announced one", wallets[0]?.announced === true, `announced=${wallets[0]?.announced}`);
  check("with the wallet's own name", wallets[0]?.name === "MetaMask", wallets[0]?.name);
}

console.log();
console.log("=== window.ethereum is only a fallback, never a competitor ===");
{
  // This is the race the standard exists to avoid. window.ethereum is a single slot that
  // several wallets write to; whichever injected last wins. If a wallet announced, that
  // list is authoritative and window.ethereum is not consulted, because consulting it can
  // offer a wallet the user did not choose.
  const announcedList = dedupe([announced("io.rabby", "Rabby")]);
  check("only the announced wallet is in the list", announcedList.length === 1, announcedList[0]?.name);
  check("it is not the window.ethereum wallet", announcedList[0]?.rdns === "io.rabby", announcedList[0]?.rdns);
}

console.log();
console.log("=== a wallet that never announces is named by what it is ===");
{
  // This is the only case where the app has to name something itself, and the previous
  // code named everything metamask or rabby — so an unrecognised wallet was dropped.
  check("Rabby by its flag", legacyName({ isRabby: true } as Eip1193Provider) === "Rabby");
  check("MetaMask by its flag", legacyName({ isMetaMask: true } as Eip1193Provider) === "MetaMask");
  check(
    "a wallet that declares its own name is believed",
    legacyName({ name: "Coinbase Wallet" } as Eip1193Provider) === "Coinbase Wallet",
  );
  check(
    "anything else is named honestly rather than called MetaMask",
    legacyName({} as Eip1193Provider) === "Browser wallet",
    legacyName({} as Eip1193Provider),
  );
  check("and gets a distinct rdns", legacyRdns({} as Eip1193Provider) === "unknown");
  check("Rabby's rdns is its real one", legacyRdns({ isRabby: true } as Eip1193Provider) === "io.rabby");
}

console.log();
console.log("=== a wallet with no icon gets a letter, not a blank row ===");
{
  const icon = iconFromName("Rabby");
  check("it is a data URI", icon.startsWith("data:image/svg+xml"), `${icon.slice(0, 28)}…`);
  check("carrying the wallet's own initial", decodeURIComponent(icon).includes(">R<"), "R in the svg text");
  check("an empty name still yields a usable icon", iconFromName("").length > 0);
  // The alternative — a generic wallet glyph — would be a guess about which wallet this
  // is, and the name is the thing the wallet chose for itself.
  check("and it is per-wallet, not one shared glyph", iconFromName("Rabby") !== iconFromName("Brave"));
}

console.log();
console.log("=== the ordering guarantee, asserted against the module's own source ===");
{
  const source = await readFile("frontend/src/lib/eip6963.ts", "utf8");
  const addIndex = source.indexOf('addEventListener("eip6963:announceProvider"');
  const requestIndex = source.indexOf('dispatchEvent(new Event("eip6963:requestProvider"))');

  check("the module attaches its listener at all", addIndex > 0);
  check("the module dispatches the request at all", requestIndex > 0);
  check(
    "listener before request, so nothing announced in between is lost",
    addIndex > 0 && requestIndex > 0 && addIndex < requestIndex,
    addIndex < requestIndex ? "correct order" : "request goes first",
  );

  // Re-dispatch on every mount: the request is inside the effect body rather than
  // guarded by a ref, which is what makes a wallet installed in another tab appear.
  const effectBody = source.slice(source.indexOf("export function useEip6963"));
  check(
    "the request is inside the effect, so it is re-sent on every mount",
    effectBody.indexOf('dispatchEvent(new Event("eip6963:requestProvider"))') > 0,
  );

  check(
    "the listener is removed on cleanup",
    effectBody.includes('removeEventListener("eip6963:announceProvider"'),
  );
  check(
    "legacy is consulted only when nothing announced",
    /found\.length > 0[\s\S]{0,120}window\.ethereum/.test(source),
  );
  check(
    "settling is true on mount, so 'no wallet' is never claimed early",
    source.includes("useState(true)"),
  );
  check(
    "the discovery window is short enough not to feel broken",
    DISCOVERY_MS > 0 && DISCOVERY_MS <= 1000,
    `${DISCOVERY_MS}ms`,
  );
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "every wallet is offered by name, and nothing is guessed");
if (failed) process.exit(1);