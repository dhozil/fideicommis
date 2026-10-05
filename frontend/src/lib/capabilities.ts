import "server-only";

import { readJSON } from "./genlayer";

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
 * Upgradeability, cached per address like the method list.
 *
 * A separate cache because the two facts have different shapes: the method list is fetched
 * from a schema call, and this is a view read. Both are immutable per deployment, so neither
 * is a cache of live data that could go stale.
 */
const upgradeCache = new Map<string, Upgradeability | null>();

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

/**
 * Whether the code at an address can be replaced, and by whom.
 *
 * This is a different question from "does it have the methods the reader needs", and the
 * two used to be conflated: the reader's `Name the code upgraders` button was a write that
 * could only ever be granted by someone who was already an upgrader, so it was dead surface
 * presented as a control. Nothing in the method list reveals whether the *code* is mutable,
 * because `upgraders` lives in the GenVM root slot rather than in the contract's storage.
 *
 * A trust can therefore be perfectly readable and still have its code swapped by an address
 * no view method discloses. That is a property of the deployment rather than of the source,
 * so it has to be read per address.
 *
 * Deployments made before the constructor stopped naming the deployer report that deployer,
 * and it is permanent: the list survives every upgrade and an upgrader can re-add itself.
 * Reported rather than hidden, because it is exactly the sort of thing a reader exists to
 * surface.
 */
export interface Upgradeability {
  /** Addresses that can replace this contract's code in place. Empty means frozen. */
  upgraders: string[];
  /** False when the deployment predates the view and the answer could not be read. */
  known: boolean;
}

export async function upgradeabilityOf(address: string): Promise<Upgradeability> {
  const key = address.trim().toLowerCase();
  const cached = upgradeCache.get(key);
  if (cached !== undefined) return cached ?? { upgraders: [], known: false };

  let answer: Upgradeability | null = null;
  try {
    const names = await methodsAt(address);
    if (names?.has("get_code_upgraders")) {
      // The SDK reader is used rather than hand-rolled RPC. Raw `gen_call` was tried in three
      // parameter shapes and all three answered `ERR 'type'` — a node-side error from
      // guessing the shape. The SDK call works and is already the project's tested path; the
      // one SDK method that is broken is `getContractSchema`, which is why the schema above
      // goes around it and this does not.
      const parsed = await readJSON<unknown>(address, "get_code_upgraders");
      const list = typeof parsed === "string" ? (JSON.parse(parsed) as unknown) : parsed;
      answer = Array.isArray(list)
        ? { upgraders: list.map(String), known: true }
        : { upgraders: [], known: false };
    } else {
      // An older build has no such view, so its code mutability is not discoverable from the
      // contract at all. That is the honest answer: unknown, not "safe".
      answer = { upgraders: [], known: false };
    }
  } catch {
    answer = { upgraders: [], known: false };
  }

  upgradeCache.set(key, answer);
  return answer;
}