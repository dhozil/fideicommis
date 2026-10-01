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
}

const TTL_MS = 60_000;
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
    if (now - entry.at > TTL_MS) cache.delete(key);
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
): Promise<T> {
  const key = keyOf(address, method, args);
  const now = Date.now();
  prune(now);

  const hit = cache.get(key);
  if (hit && now - hit.at <= TTL_MS) {
    return Promise.resolve(hit.value as T);
  }

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const call = fetch()
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
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