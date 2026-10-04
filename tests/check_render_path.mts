/**
 * The chain is not in the path to a first paint.
 *
 * The trust page used to `await readTrust()` in the server component, so the first byte of
 * HTML waited for fifteen view calls. That is the whole of the reader's slowness, and it was
 * not fixable underneath itself: no amount of tuning the concurrency, the batching or the
 * read budget changes a page whose bytes cannot be written until every read has returned.
 * The fix had to be structural — a shell that paints, and a record fetched after — which is
 * exactly what the reference project does with a static HTML shell and browser-side reads.
 *
 * A structural fix is easy to undo by accident, and nothing would fail: the page would just
 * go back to being slow. So the shape is asserted here.
 *
 * Run: npx tsx@4 tests/check_render_path.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "..", p), "utf-8");

const rawPage = read("frontend/src/app/trust/[address]/page.tsx");
const rawView = read("frontend/src/components/TrustRecordView.tsx");
const rawRoute = read("frontend/src/app/api/trust/[address]/route.ts");
const genlayer = read("frontend/src/lib/genlayer.ts");
const layout = read("frontend/src/app/layout.tsx");

/**
 * Source with its comments removed.
 *
 * page.tsx and TrustRecordView.tsx both *describe* the thing this file checks — the page
 * used to await readTrust, and that is worth writing down. So a check that searched the raw
 * text for `await readTrust` failed on the explanation, which is exactly backwards: it
 * would push towards deleting the reason the code looks the way it does. Behaviour is
 * asserted against code, and prose about behaviour is ignored.
 *
 * The raw text is kept as `rawPage` for the one assertion that is genuinely about prose.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pageCode = code(rawPage);
const viewCode = code(rawView);
const routeCode = code(rawRoute);

// Aliased so every assertion below reads as behaviour rather than as file reading, and so
// a future check cannot accidentally reach for the commented source.
const page = pageCode;
const view = viewCode;
const route = routeCode;

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

console.log("=== the page does not read the chain ===");
{
  // Assertions are about *imports*, not about the word appearing. page.tsx names readTrust
  // in a comment explaining what it used to do, and a check that forbade the string would
  // fail on the explanation rather than on the behaviour — which is the wrong thing to fail
  // on, because it pushes towards deleting the reason the code looks the way it does.
  check("it does not import readTrust", !/^import .*readTrust/m.test(page));
  check("it does not call it either", !/await readTrust/.test(page));
  check("it imports nothing from the chain client", !/from "@\/lib\/(genlayer|trust)"/.test(page));
  check("the only thing it renders from a view is a skeleton", /skeleton-title/.test(page));
}

console.log();
console.log("=== the reads moved to a route, not to the browser ===");
{
  check("the route is the thing that reads the chain", /readTrust\(decoded\)/.test(route));
  // This is the part that would be easy to get wrong for the sake of speed. The reads stay
  // server-side: lib/genlayer.ts is `server-only`, so moving them into the browser either
  // breaks that guard or deletes it, and the site's claim that it holds no key and that
  // every figure is a repeatable call rests on one code path doing the reading.
  check("genlayer is still server-only", /import "server-only"/.test(genlayer));
  check("the route is server-side too", /export const runtime = "nodejs"/.test(route));
  check("and is never cached", /force-dynamic/.test(route));
  check("the record is sent no-store as well", /no-store/.test(route));
}

console.log();
console.log("=== the browser fetches, and every outcome is distinguished ===");
{
  check("the view fetches the route", /fetch\(`\/api\/trust\//.test(view));
  // Four states, four behaviours. Collapsing 404 and 429 into one "failed" is how a reader
  // ends up telling someone their address is wrong when the truth is that the node is
  // rate-limiting every reader at once.
  check("a 404 is a wrong address, not a broken site", /status === 404/.test(view));
  check("a 429 is named as throttling", /status === 429/.test(view));
  check("any other status is still distinguished", /!response\.ok/.test(view));
  check("a fetch that never reached the server is its own message", /\.catch\(\(error: Error\)/.test(view));
  check("a degraded record is still rendered, not discarded", /record\.degraded/.test(view));
}

console.log();
console.log("=== nothing is shown before it has been read ===");
{
  // The reader's whole argument is that its figures come from the contract. A placeholder
  // figure is the one thing that would make the page worse than a blank one.
  check("the waiting state names the calls it is waiting on", /get_\*/.test(view));
  check("and says nothing is shown until they answer", /until they answer/.test(view));
  check("a failed read shows no figure at all", /a figure that was not read is not zero/.test(view));
}

console.log();
console.log("=== the page has one heading at a time, and the record owns it ===");
{
  // Two h1s in one document is a document with two titles. The file has two because it has
  // two mutually exclusive branches — a wrong address and a record — and only one of them
  // ever renders. Counting occurrences in the file would flag that as a bug when it is the
  // correct shape, so this asserts the branch split instead: an early return on the
  // not-a-trust case, before the record's own h1 can be reached.
  check("the shell renders no heading of its own", !/<h1/.test(page));
  check("the record renders one heading", (view.match(/<h1/g) ?? []).length === 2);
  check("one of them is the trust's own name", /\{record\.name\}/.test(view));
  check("the other names the not-a-trust case", /Nothing answered at that address/.test(view));
  const earlyReturn = view.indexOf("Nothing answered at that address");
  const recordHeading = view.indexOf("{record.name}");
  check(
    "and the wrong-address branch returns before the record one",
    earlyReturn > 0 && recordHeading > 0 && earlyReturn < recordHeading,
  );
}

console.log();
console.log("=== giving up server rendering cost nothing that was being used ===");
{
  // The reason this change is right rather than merely fast. Server rendering buys two
  // things: a crawlable page, and a fast first paint with data. This reader has
  // deliberately forgone the first and could not achieve the second, because the data is
  // behind fifteen slow reads.
  check("the reader is noindex", /index: false, follow: false/.test(layout));
  check("so the SEO half of SSR was already forgone by choice", /robots/.test(layout));
}

console.log();
console.log("=== a trust that is not one is still a 404 ===");
{
  check("the route maps NotATrust to 404", /status: 404/.test(route));
  check("and the browser shows it as a wrong address, not an error", /Nothing answered at that address/.test(view));
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "the chain is not in the path to a first paint");
if (failed) process.exit(1);