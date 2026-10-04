import { NextResponse } from "next/server";
import { NotATrust, readTrust } from "@/lib/trust";
import { RateLimitedError } from "@/lib/genlayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One trust, as JSON, for the reader to fetch.
 *
 * This route exists so the chain is not in the request path for the page itself. The
 * trust page used to `await readTrust()` directly, which meant the first byte of HTML
 * waited for fifteen view calls to a node that takes seconds to answer — and the reader is
 * deliberately `noindex`, so the one thing server rendering was buying was a first paint
 * with data, which is exactly the thing that could not arrive quickly.
 *
 * The reads are still made here, on the server. That is not a detail:
 *
 *   - `lib/genlayer.ts` is `server-only`, so this stays the only place the chain is
 *     touched, and moving it to the browser would either break that guard or delete it.
 *   - The site's central claim is that it holds no key and that every figure is a call
 *     anyone can repeat. Fetching from the browser does not threaten either on its own,
 *     but keeping the reads server-side keeps one code path doing them, which is what
 *     keeps the claim checkable.
 *   - A JSON response is cacheable by the browser and by a CDN in a way an HTML document
 *     with `force-dynamic` is not.
 *
 * The statuses are distinct on purpose, because they mean different things to a reader and
 * collapsing them into one 500 would make them look the same:
 *
 *   404  the address is not a Fideicommis — a wrong address, not a broken site
 *   429  the node is rate-limiting us; retrying sooner is the reader's problem, not ours
 *   200  a record, possibly carrying `degraded` views that failed individually
 *
 * A partially-readable trust is still a 200. `readTrust` fills an unanswered view rather
 * than throwing, so the degraded list arrives inside the record and the page names it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const decoded = decodeURIComponent(address);

  try {
    const record = await readTrust(decoded);
    return NextResponse.json(record, {
      headers: {
        // A record is a snapshot of a live chain, so it is not stored anywhere. No-store
        // keeps a reader from being shown yesterday's trust after a vote.
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotATrust) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}