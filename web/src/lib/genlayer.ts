import "server-only";

import { createClient, chains } from "genlayer-js";

/**
 * The SDK exports its client type under an internal name only, so the type is
 * derived from the factory rather than imported. That keeps this file working if
 * the package renames its internals, which a hand-written import would not.
 */
type GenClient = ReturnType<typeof createClient>;

/**
 * The GenLayer reader.
 *
 * Three things here were learned the hard way on a real network and are worth
 * more than any amount of abstraction:
 *
 *  1. **Only a browser-like User-Agent gets through.** The Node SDK sets one; a
 *     plain `fetch` from a server does not reliably, so the SDK is used rather
 *     than hand-rolled JSON-RPC.
 *  2. **30 requests a minute, 500 an hour**, rejected with `-32029` and a
 *     `retry_after_seconds` hint. Every call is paced and backs off on the hint.
 *     Without this a single page render spends the whole budget and the next
 *     reader sees a throttled node instead of a trust.
 *  3. **Reads retry.** A contract deployed with `on="finalized"` is not readable
 *     until the parent finalizes, so "not found" and "execution failed" are
 *     transient rather than fatal.
 *
 * The client is constructed with no account at all. Reads do not need one, which
 * is why this app holds no key: `server-only` at the top of the file makes that a
 * build error rather than a review comment if someone later imports it into a
 * client component.
 */

const SPACING_MS = 2100;
const READ_ATTEMPTS = 5;
const READ_BACKOFF_MS = 2500;

export class RateLimitedError extends Error {
  constructor() {
    super("The GenLayer node is rate-limiting this IP. Try again in about a minute.");
    this.name = "RateLimitedError";
  }
}

export class NotATrustError extends Error {
  constructor(address: string, reason: string) {
    super(`${address} is not a Fideicommis, or its rulebook is not derived yet. ${reason}`);
    this.name = "NotATrustError";
  }
}

let client: GenClient | undefined;
let lastCallAt = 0;
/** Serialises concurrent work so two readers cannot interleave and trip the limit. */
let queue: Promise<unknown> = Promise.resolve();

function getClient(): GenClient {
  if (!client) client = createClient({ chain: chains.studionet });
  return client;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterSeconds(err: unknown): number | undefined {
  const e = err as {
    data?: { retry_after_seconds?: number };
    cause?: { data?: { retry_after_seconds?: number } };
    message?: string;
  };
  const hint = e?.data?.retry_after_seconds ?? e?.cause?.data?.retry_after_seconds;
  if (hint !== undefined) return Number(hint);
  if (/rate limit|too many requests|-32029/i.test(e?.message ?? "")) return 10;
  return undefined;
}

/** One call, paced, with backoff. All traffic goes through here. */
async function paced<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wait = lastCallAt + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    try {
      return await fn();
    } catch (err) {
      const hint = retryAfterSeconds(err);
      if (hint === undefined || attempt === attempts - 1) throw err;
      await sleep((hint + 2) * 1000);
    }
  }
  throw new RateLimitedError();
}

/** Work is queued rather than fired, so a burst of pages cannot outrun the limit. */
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function readContract(address: string, method: string, args: unknown[] = []): Promise<unknown> {
  return serialise(() =>
    paced(async () => {
      const c = getClient();
      let lastError: unknown;
      for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
        try {
          return await c.readContract({
            address: address as `0x${string}`,
            functionName: method,
            args: args as never,
          });
        } catch (err) {
          lastError = err;
          const message = (err as Error)?.message ?? "";
          if (!/execution failed|invalid parameters|not found|unknown method/i.test(message)) throw err;
          await sleep(READ_BACKOFF_MS);
        }
      }
      throw lastError;
    }),
  );
}

/** Reads a view that returns a JSON-encoded string, the way every view here does. */
export async function readJSON<T>(address: string, method: string, args: unknown[] = []): Promise<T> {
  const raw = await readContract(address, method, args);
  if (raw !== null && typeof raw === "object") return raw as T;
  if (typeof raw !== "string") throw new Error(`${method} returned ${typeof raw}, not a string`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${method} did not return JSON; it returned ${JSON.stringify(raw.slice(0, 120))}`);
  }
}

export async function readString(address: string, method: string, args: unknown[] = []): Promise<string> {
  const raw = await readContract(address, method, args);
  if (typeof raw === "string") return raw;
  return String(raw ?? "");
}
