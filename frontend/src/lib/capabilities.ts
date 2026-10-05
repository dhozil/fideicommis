import "server-only";

/**
 * What a deployed trust's bytecode actually exposes.
 *
 * The reader offers writes that were added to the contract over time. Studionet cannot
 * upgrade a contract, so an address deployed from an earlier source does not have the newer
 * ones, and offering a button for a method that is not there fails at the node with a
 * message that does not name the method. Measured with `scripts/capabilities.cjs`: all three
 * listed deployments carry every write the reader offers, so nothing is hidden from them
 * today — this exists for the addresses nobody listed, which is the whole point of a reader
 * that opens any address.
 *
 * Three ways of finding a deployment's methods were tried, and the two obvious ones fail:
 *
 *   - **Reading each write as a view.** Useless. A write called through `readContract`
 *     answers "Missing or invalid parameters" — and so does `clear_rules`, also a write, and
 *     so does a method name invented on the spot. All three are indistinguishable, so a
 *     probe built this way would report every method as missing, or none, depending on how
 *     the errors happened to be worded.
 *   - **The SDK's `getContractSchema`.** Fails node-side on this build with a psycopg2
 *     error (`can't adapt type 'dict'`), so the SDK's typed call cannot answer the question.
 *   - **Raw `gen_getContractSchema` over JSON-RPC.** Works, and returns `ctor` and `methods`.
 *
 * So the probe goes around the SDK deliberately. The SDK is still used for reads and writes;
 * this one call is hand-rolled because the typed path is the broken one.
 *
 * Two properties make it safe to run on the request path:
 *
 *   - **It is cached per address, forever.** A deployment's method set cannot change, because
 *     the network cannot upgrade a contract. This is not a cache of live data that could go
 *     stale — it is a cache of a fact about the bytecode, which is immutable by construction.
 *   - **It fails open.** If the probe errors, every write is assumed present. A node hiccup
 *     must not remove functionality: a reader that hides a working button because it could
 *     not check is worse than one that offers a button and reports the refusal honestly,
 *     which `WritePanel` already does.
 */

/** Every write the reader can send. A deployment missing one cannot be driven through it. */
export const READER_WRITES = [
  "fund",
  "set_policy",
  "set_code_upgraders",
  "bootstrap_rules",
  "submit_proposal",
  "assess_proposal",
  "cast_vote",
  "execute_proposal",
  "review_delivery",
  "advance_cycle",
] as const;

export type ReaderWrite = (typeof READER_WRITES)[number];

export interface Capabilities {
  /** Writes this deployment does not have. Empty means every button may be offered. */
  missing: ReaderWrite[];
  /** False when the probe failed and the answer is an assumption rather than a fact. */
  verified: boolean;
}

const RPC_URL = "https://studio.genlayer.com/api";

/**
 * Method names per address, for the process lifetime.
 *
 * Keyed by lowercase address because the schema is a property of the account, not of the
 * casing someone typed. `null` records a failed probe so a failing node is asked once
 * rather than on every render.
 */
const cache = new Map<string, Set<string> | null>();

async function methodsAt(address: string): Promise<Set<string> | null> {
  const key = address.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let names: Set<string> | null = null;
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Only a browser-like User-Agent gets through Cloudflare. This was measured, not
        // assumed — see the note at the top of genlayer.ts.
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "gen_getContractSchema",
        params: [address],
      }),
      cache: "no-store",
    });
    const body = (await response.json()) as {
      result?: { methods?: unknown };
      error?: { message?: string };
    };
    if (body.error) throw new Error(body.error.message ?? "rpc error");
    const methods = body.result?.methods;
    if (!methods) throw new Error("no methods in the schema");
    names = new Set(
      (Array.isArray(methods) ? methods : Object.keys(methods)).map((entry) =>
        typeof entry === "string" ? entry : ((entry as { name?: string })?.name ?? ""),
      ),
    );
  } catch {
    names = null;
  }

  cache.set(key, names);
  return names;
}

/**
 * Which writes this deployment lacks, or an honest "could not tell".
 *
 * `verified: false` means the probe failed and `missing` is empty because nothing was
 * ruled out — not because everything was confirmed. The panels do not use that to hide
 * anything, and `WritePanel` reports a real refusal if one is attempted.
 */
export async function capabilitiesOf(address: string): Promise<Capabilities> {
  const names = await methodsAt(address);
  if (!names) return { missing: [], verified: false };
  return {
    missing: READER_WRITES.filter((method) => !names.has(method)),
    verified: true,
  };
}