import "server-only";

/**
 * A small cache for contract reads, and the two things it has to get right.
 *
 * Why this exists at all. The reader is server-rendered, so every navigation is a
 * fresh server render and a fresh set of reads. The node allows 30 requests a minute
 * per IP, and the record page makes ten of them. So navigating from the landing page
 * to the trust it features spent the budget twice over on the same address, and a
 * reader that re-read a trust to show the same figures is not reading, it is
 * re-fetching. This is the server-side equivalent of what the client-side reference
 * project gets from TanStack Query: a TTL, and coalescing of identical reads that are
 * already in flight.
 *
 * **Coalescing is the part that fixes the reported symptom.** Two renders that ask for
 * the same method at the same time must share one call. Without it, the landing page
 * and a trust record opened from it both call `get_org_summary` on the same address
 * in the same second, and two readers cost what one should. This keeps the promise
 * instead, so the second caller waits for the first and reuses it.
 *
 * **The TTL is short and deliberate.** A trust is a live thing: the point of the
 * reader is that it shows what the chain says now. Caching for a minute would make a
 * settled grant invisible, and a reader that lags is worse than a reader that is
 * slow. One minute is chosen because it is also the node's own budget period, so a
 * fresh value and a full budget of requests line up.
 *
 * What this does not do: it never serves a value that failed. A read that errored is
 * not cached, so a throttled moment does not become a minute of a broken page.
 */

interface Entry {
  value: unknown;
  at: number;
  /** Set when this entry is a remembered failure rather than a value. */
  failure?: unknown;
  /** A remembered failure expires sooner than a value does. */
  ttlMs?: number;
}

const TTL_MS = 60_000;

/**
 * How long a *named* failure is remembered.
 *
 * Shorter than a value's, because a value on this reader is a chain state and a
 * remembered failure is a guess about one: "the node had not seen this yet" is true for
 * half a minute and then probably wrong, since the transaction is still settling. Thirty
 * seconds is long enough to collapse a refresh and short enough that a fresh read wins
 * soon after. It is the same reasoning as the receipt TTL, applied to absence.
 */
const REJECTION_TTL_MS = 30_000;

const MAX_ENTRIES = 400;

/** address:method:args -> the last good value. */
const cache = new Map<string, Entry>();

/** address:method:args -> the call currently running, shared by every caller. */
const inflight = new Map<string, Promise<unknown>>();

function keyOf(address: string, method: string, args: unknown[]): string {
  return `${address.toLowerCase()}:${method}:${JSON.stringify(args)}`;
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (now - entry.at > (entry.ttlMs ?? TTL_MS)) cache.delete(key);
  }
  // The map is bounded so a crawler walking thousands of addresses cannot grow it
  // without limit. Eviction is oldest-first, which is fine: the oldest entries are
  // the ones about to expire anyway.
  if (cache.size > MAX_ENTRIES) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [key] of sorted.slice(0, cache.size - MAX_ENTRIES)) cache.delete(key);
  }
}

/**
 * Read through the cache.
 *
 * `fetch` is passed in rather than called here so this module holds no chain client
 * and can be reasoned about on its own. A value already held and still fresh returns
 * immediately; a read already running is awaited rather than started again.
 */
export function cached<T>(
  address: string,
  method: string,
  args: unknown[],
  fetch: () => Promise<T>,
  options: { cacheRejection?: (error: unknown) => boolean; rejectionTtlMs?: number } = {},
): Promise<T> {
  const key = keyOf(address, method, args);
  const now = Date.now();
  prune(now);

  const hit = cache.get(key);
  if (hit && now - hit.at <= (hit.ttlMs ?? TTL_MS)) {
    // A stored rejection is re-thrown rather than returned as a value, so the caller's
    // error handling is unchanged and cannot tell a replayed failure from a fresh one.
    if (hit.failure) return Promise.reject(hit.failure);
    return Promise.resolve(hit.value as T);
  }

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const call = fetch()
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((error) => {
      // A failure is never cached by default: a throttled moment must not become a
      // minute of a broken page.
      //
      // Some failures are not moments, though. The node answers a transaction hash it
      // has never seen by *throwing* — "could not be found. The Transaction may not be
      // processed on a block yet" — rather than returning null. That makes the commonest
      // answer on a hash URL a rejection, and a cache that cannot hold it re-asks the
      // node on every visit. So a caller may name the failures worth remembering, and
      // only those, and they are remembered on a shorter TTL than a good value.
      //
      // The predicate is the caller's because "worth remembering" is a claim about
      // meaning, not about transport: a rate limit is not the same as an absence.
      if (options.cacheRejection?.(error)) {
        cache.set(key, {
          value: null,
          failure: error,
          at: Date.now(),
          ttlMs: options.rejectionTtlMs ?? REJECTION_TTL_MS,
        });
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, call);
  return call;
}

/** Drop one address's values, so a reader can be told its figures are out of date. */
export function invalidate(address: string): void {
  const needle = address.toLowerCase();
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${needle}:`)) cache.delete(key);
  }
}

/**
 * When a cached value was stored, or null if it is not held.
 *
 * This exists because a page showing a cached receipt has to say how old it is, and a
 * reader cannot otherwise tell "the committee decided this eleven seconds ago" from
 * "this is what the committee decided, read once and now pinned". The distinction only
 * exists if the age is reported, so it is reported rather than inferred.
 */
export function ageOf(address: string, method: string, args: unknown[]): number | null {
  const hit = cache.get(keyOf(address, method, args));
  return hit ? Date.now() - hit.at : null;
}

/** Whether a value is held but past its TTL, which is the case worth not serving. */
export function isStale(address: string, method: string, args: unknown[]): boolean {
  const hit = cache.get(keyOf(address, method, args));
  return !hit || Date.now() - hit.at > (hit.ttlMs ?? TTL_MS);
}

/** Whether what is held for this key is a remembered failure rather than a value. */
export function isRememberedFailure(address: string, method: string, args: unknown[]): boolean {
  return cache.get(keyOf(address, method, args))?.failure !== undefined;
}

/**
 * What the cache is holding, for the /verify page and for anyone who wants to check
 * that the claim "this is a snapshot of a live chain" is being kept honestly.
 */
export function cacheReport(): { entries: number; oldestMs: number; addresses: number } {
  const now = Date.now();
  const entries = [...cache.values()];
  const addresses = new Set([...cache.keys()].map((key) => key.split(":")[0]));
  return {
    entries: cache.size,
    oldestMs: entries.length ? now - Math.min(...entries.map((entry) => entry.at)) : 0,
    addresses: addresses.size,
  };
}