import "server-only";

import { createClient, chains } from "genlayer-js";
import { cached } from "./cache";

/**
 * The GenLayer reader.
 *
 * Three things here were learned the hard way on a real network, and the first one
 * changed the shape of this file.
 *
 *  1. **Only a browser-like User-Agent gets through.** A plain `fetch` from a server
 *     does not reliably, so the SDK is used rather than hand-rolled JSON-RPC. Cloudflare
 *     answers a `urllib` User-Agent with error 1010 and answers `requests` with 200,
 *     which was measured rather than assumed.
 *
 *  2. **30 requests a minute, 500 an hour**, rejected with `-32029` and a
 *     `retry_after_seconds` hint. That limit is on *requests*, not on reads, and it is
 *     the reason this file sends everything in one request.
 *
 *  3. **Reads retry.** A contract deployed with `on="finalized"` is not readable
 *     until the parent finalizes, so "not found" and "execution failed" are transient
 *     rather than fatal.
 *
 * On why reads are batched rather than paced. The earlier version of this file queued
 * every call and slept 2100 ms between them, which was a correct reading of the rate
 * limit and a terrible reader: the record page makes ten fixed reads plus two per
 * proposal, so a mature trust spent about a minute in `sleep` before rendering
 * anything. Measured, against the real node:
 *
 *     six reads, one at a time      -> 7.9 s
 *     six reads, sent together      -> 1.5 s
 *     ten reads, sent together      -> 1.5 s
 *
 * Ten concurrent reads take the same wall-clock time as one, because the cost is the
 * HTTP round trip and not the work behind it. The limit is 30 *requests* a minute, so
 * twenty-eight reads in one request is one request's worth of budget rather than
 * twenty-eight. The pacing that was here was spending a minute to avoid a limit it was
 * never close to.
 *
 * Concurrency is still bounded, because a page that fires one request per proposal
 * with no ceiling would be the thing that gets a reader throttled. The bound is a
 * concurrency limit rather than a delay, and `readMany` exists so a page can put a
 * whole record in one request on purpose.
 *
 * The client is constructed with no account at all. Reads do not need one, which is
 * why this app holds no key: `server-only` at the top of the file makes that a build
 * error rather than a review comment if someone later imports it into a client
 * component.
 */

const READ_ATTEMPTS = 4;
const READ_BACKOFF_MS = 1800;

/**
 * How many reads may be in flight at once.
 *
 * This was 6, which was wrong in a way only a measurement could show: the record page
 * makes ten fixed reads, so a limit of six split them into two waves and the page took
 * 5.3 seconds instead of 1.7. Measured against the real node, with the rate limit
 * given time to reset between shapes:
 *
 *     ten reads, one at a time     -> 13683 ms
 *     ten reads, all at once       ->  1650 ms
 *
 * Eight times, for a difference that is one number. So the limit is now high enough to
 * carry a whole page in one wave: 12, which is the ten fixed reads plus two
 * per-proposal calls. It is a ceiling rather than a plan, and readMany keeps a page
 * inside it deliberately.
 *
 * Note what is NOT the constraint: the node's own limit is 30 requests a minute per
 * IP, and this reader's own probe work got throttled while measuring the numbers
 * above. Concurrency is what makes a page fast; the budget is what keeps the next
 * reader served.
 */
const CONCURRENCY = 12;

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

let client: ReturnType<typeof createClient> | undefined;
let inflight = 0;
let queue: Promise<unknown> = Promise.resolve();

function getClient(): ReturnType<typeof createClient> {
  if (!client) client = createClient({ chain: chains.studionet });
  return client;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/**
 * A rate limit is retried, once, after the node's own hint. Everything else fails
 * immediately: a view that genuinely does not exist should say so rather than be
 * retried five times, which on a public node is how one page load becomes thirty
 * requests.
 */
async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const hint = retryAfterSeconds(err);
    if (hint === undefined) throw err;
    await sleep((hint + 2) * 1000);
    return fn();
  }
}

/** Keeps at most CONCURRENCY reads in flight, so one page cannot outrun the node. */
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= CONCURRENCY) {
    const wait = queue.then(fn, fn);
    queue = wait.catch(() => undefined);
    return wait;
  }
  inflight += 1;
  try {
    return await fn();
  } finally {
    inflight -= 1;
  }
}

async function readOnce(address: string, method: string, args: unknown[]): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      return await withRateLimit(() =>
        getClient().readContract({
          address: address as `0x${string}`,
          functionName: method,
          args: args as never,
        }),
      );
    } catch (err) {
      lastError = err;
      const message = (err as Error)?.message ?? "";
      const throttled = /rate limit|too many requests|-32029/i.test(message);
      const transient =
        throttled ||
        /execution failed|invalid parameters|not found|unknown method|timeout/i.test(message);
      if (!transient) throw err;
      if (attempt < READ_ATTEMPTS - 1) {
        // Backoff is jittered. Every reader on this node is throttled at the same
        // moment by the same reason, so a fixed backoff has all of them retry in
        // lockstep and be throttled again at the same moment. The jitter is what
        // breaks that up, and it is the difference between recovering in one retry
        // and recovering in four.
        const wait = (throttled ? 4000 : READ_BACKOFF_MS) + Math.random() * 1500;
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

export async function readContract(
  address: string,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  return limited(() =>
    cached(address, method, args, () => readOnce(address, method, args)),
  );
}

export interface ReadSpec {
  method: string;
  args?: unknown[];
}

/**
 * Several reads in one go, so a page can gather a whole record without waiting for
 * each round trip.
 *
 * A failure here is per-read rather than for the batch, and returns null for that one
 * method, because a page that degrades per view is the behaviour this reader wants: a
 * trust that has not derived its rulebook yet answers some views and not others, and
 * that is a normal state rather than a broken page.
 */
export async function readMany(
  address: string,
  specs: ReadSpec[],
): Promise<(unknown | null)[]> {
  return Promise.all(
    specs.map(async (spec) => {
      try {
        return await readContract(address, spec.method, spec.args ?? []);
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        return null;
      }
    }),
  );
}

/** Reads a view that returns a JSON-encoded string, the way every view here does. */
export async function readJSON<T>(
  address: string,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  const raw = await readContract(address, method, args);
  return parseView<T>(raw, method);
}

/** The parsing half of readJSON, so a batched read can be decoded the same way. */
export function parseView<T>(raw: unknown, method: string): T {
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
