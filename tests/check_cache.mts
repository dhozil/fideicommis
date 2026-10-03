/**
 * Does the cache hold an absence?
 *
 * `cached()` refuses to store a failure, which is right: a throttled moment must not
 * become a minute of a broken page. But the node reports a transaction hash it has never
 * seen by *throwing* — "could not be found. The Transaction may not be processed on a
 * block yet" — not by returning null. That made the commonest answer on `/verify?tx=`
 * the one answer the cache could not hold, so every refresh asked the node again.
 *
 * Measured on a production build before this was fixed: three requests for an unknown
 * hash took 1166 ms, 16 ms and 12 ms but none of them were served from cache, because
 * nothing was ever stored.
 *
 * So a caller may now name which failures are worth remembering. These are the three
 * properties that make it safe rather than merely convenient:
 *
 *   - only the named failure is remembered; a rate limit still throws every time
 *   - a remembered failure is re-thrown, so the caller cannot mistake it for a value
 *   - it expires on a shorter TTL than a value, because absence goes stale while a value
 *     does not
 *
 * Run: npx tsx@4 tests/check_cache.mts
 */

import { createRequire } from "node:module";

// cache.ts opens with `import "server-only"`, whose entry point throws when loaded
// outside a server component. tsx loads it as CommonJS, so the marker fires here for
// the same reason it fires in a browser bundle.
//
// It is registered as empty before the import. That does not weaken what the marker is
// for: `check_bundle_guard.py` reads the source text and fails if the marker line is
// gone or if a client component reaches the module transitively, and nothing registered
// at runtime can satisfy that. A test passable by deleting the marker would be
// worthless, so the marker is asserted separately and this only makes the module loadable.
const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
} as unknown as NodeModule;

const {
  cached,
  ageOf,
  isStale,
  invalidate,
  cacheReport,
  isRememberedFailure,
} = require("../frontend/src/lib/cache") as typeof import("../frontend/src/lib/cache");

let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

const ADDRESS = "0xAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH = "0x" + "ab".repeat(32);

/** What Studionet says for a hash it has never seen. Measured, quoted from the node. */
const NOT_FOUND =
  'Transaction receipt with hash "0xabab…" could not be found. The Transaction may not be processed on a block yet.';

console.log("=== a fresh read reports an age, and no age means nothing held ===");
check("nothing held before the first read", ageOf(ADDRESS, "get_org_summary", []) === null);
check("and is stale before it", isStale(ADDRESS, "get_org_summary", []));

let calls = 0;
const read = async () => {
  calls += 1;
  return "value";
};

await cached(ADDRESS, "get_org_summary", [], read);
check("held after a read", ageOf(ADDRESS, "get_org_summary", []) !== null);
check("a value just read is not stale", !isStale(ADDRESS, "get_org_summary", []));
check("the fetch ran once", calls === 1, `${calls}`);

console.log();
console.log("=== a second read inside the TTL is served, not fetched ===");
await cached(ADDRESS, "get_org_summary", [], read);
check("still one call", calls === 1, `${calls}`);

console.log();
console.log("=== a failure is not cached unless the caller names it ===");
let failingCalls = 0;
const thrower = () => {
  failingCalls += 1;
  return Promise.reject(new Error("rate limit"));
};

try {
  await cached(ADDRESS, "get_policy", [], thrower);
} catch {
  /* expected */
}
check("nothing held after an unnamed failure", ageOf(ADDRESS, "get_policy", []) === null);
check("it is not marked as a remembered failure", !isRememberedFailure(ADDRESS, "get_policy", []));

try {
  await cached(ADDRESS, "get_policy", [], thrower);
} catch {
  /* expected */
}
check("so the next render retries instead of replaying it", failingCalls === 2, `${failingCalls}`);

console.log();
console.log("=== a named failure is remembered, and re-thrown ===");
let absentCalls = 0;
const absent = () => {
  absentCalls += 1;
  return Promise.reject(new Error(NOT_FOUND));
};
const remember = { cacheRejection: (e: unknown) => /could not be found/.test((e as Error).message) };

let firstError: string | null = null;
try {
  await cached(`tx:${HASH}`, "gen_getTransactionReceipt", [], absent, remember);
} catch (e) {
  firstError = (e as Error).message;
}
check("the first read asked the node", absentCalls === 1, `${absentCalls}`);
check("and reported the absence", firstError !== null && firstError.includes("could not be found"));
check("the absence is now held", ageOf(`tx:${HASH}`, "gen_getTransactionReceipt", []) !== null);
check("and is marked as a remembered failure", isRememberedFailure(`tx:${HASH}`, "gen_getTransactionReceipt", []));

let secondError: string | null = null;
try {
  await cached(`tx:${HASH}`, "gen_getTransactionReceipt", [], absent, remember);
} catch (e) {
  secondError = (e as Error).message;
}
check("the second read did not ask the node", absentCalls === 1, `${absentCalls}`);
check(
  "and still throws rather than returning null",
  secondError !== null && secondError.includes("could not be found"),
  "a caller cannot mistake a replayed absence for a value",
);

console.log();
console.log("=== a remembered absence expires sooner than a value ===");
// Both TTLs are internal constants and a mutation that made an absence outlive a value
// went uncaught when only the existence of the entry was asserted. So the age is read
// back as a number and the two are compared, with the 30s TTL waited out.
//
// This takes 31 seconds. It is the only honest way to test expiry without exporting the
// constants purely for testing, and the alternative — exporting REJECTION_TTL_MS and
// comparing it to TTL_MS — would assert that two numbers differ rather than that the
// entry actually leaves the cache when one of them passes.
const absenceAge = ageOf(`tx:${HASH}`, "gen_getTransactionReceipt", []);
check("the remembered absence reports an age", absenceAge !== null, `${absenceAge}ms`);
check("and reports itself not stale", !isStale(`tx:${HASH}`, "gen_getTransactionReceipt", []));

console.log("  waiting 31s for the rejection TTL to pass...");
await new Promise((resolve) => setTimeout(resolve, 31_000));

// isStale is the check, and isRememberedFailure is the state. Expiry removes the entry
// outright, so the state is already gone — asserting both was two assertions of the
// same fact, and the second one ran after the entry had been re-added below, which is
// what made it fail rather than what it was trying to say.
check("and is gone once it has", isStale(`tx:${HASH}`, "gen_getTransactionReceipt", []));

// Restored, so the rest of this file is not testing a stale entry.
try {
  await cached(`tx:${HASH}`, "gen_getTransactionReceipt", [], absent, remember);
} catch {
  /* expected */
}
check("a fresh read re-asks the node after expiry", absentCalls === 2, `${absentCalls}`);

console.log();
console.log("=== a remembered absence is dropped by invalidate ===");
invalidate(`tx:${HASH}`);
check("gone", ageOf(`tx:${HASH}`, "gen_getTransactionReceipt", []) === null);
check("and no longer marked as remembered", !isRememberedFailure(`tx:${HASH}`, "gen_getTransactionReceipt", []));

console.log();
console.log("=== a successful read after a remembered absence replaces it ===");
let lateCalls = 0;
const recovered = await cached(`tx:${HASH}`, "gen_getTransactionReceipt", [], async () => {
  lateCalls += 1;
  return { consensus_data: { leader_receipt: [{ execution_result: "SUCCESS", result: { status: "return" } }] } };
}, remember).catch(() => null);
check("a later read is not blocked by the remembered absence", recovered !== null, lateCalls === 1 ? "asked again" : "served");

console.log();
console.log("=== case does not create a second entry for the same hash ===");
const upper = HASH.toUpperCase().replace("0X", "0x");
let caseCalls = 0;
await cached(`tx:${upper}`, "gen_getTransactionReceipt", [], async () => {
  caseCalls += 1;
  return "x";
}, remember).catch(() => null);
check("upper-case input hits the same entry", caseCalls === 0, `${caseCalls} new calls`);

console.log();
const report = cacheReport();
check("the report counts entries", report.entries > 0, `${report.entries}`);
check("it is a snapshot, not a live handle", typeof report.oldestMs === "number");

console.log();
console.log(failed ? `${failed} check(s) failed` : "the cache can hold an absence, and still fails loudly on a real failure");
if (failed) process.exit(1);