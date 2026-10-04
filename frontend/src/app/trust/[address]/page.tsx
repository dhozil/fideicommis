import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";
import { TrustRecordView } from "@/components/TrustRecordView";
import { isListed } from "@/lib/registry";

/**
 * The trust page: a shell that paints immediately, and a record that arrives after.
 *
 * This used to `await readTrust()` in the page, so the first byte of HTML waited for
 * fifteen view calls against a node that takes seconds to answer. On the deployed reader
 * that was the whole of the wait, and no amount of tuning the concurrency underneath it
 * helped, because the page was structurally blocked on the chain: the bytes could not be
 * written until every read had come back.
 *
 * Two things made that worth changing rather than measuring again:
 *
 *   - The reader is `noindex` by choice (`layout.tsx`), so the main thing server rendering
 *     buys — a crawlable page with the data in the HTML — is already deliberately forgone.
 *   - What remained was a fast first paint with data, which is the one thing this
 *     architecture could not deliver.
 *
 * So the chain is out of the request path. This component renders the masthead, the
 * address and the navigation from the URL alone, with nothing awaited; `TrustRecordView`
 * fetches `/api/trust/[address]` in the browser and renders the panels when it lands. The
 * first paint no longer waits on a node at all.
 *
 * The reads still happen on the server, in that route. They are not moved into the browser
 * — see the note on `app/api/trust/[address]/route.ts` for why that matters.
 */
export default async function TrustPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const decoded = decodeURIComponent(address);

  return (
    <main id="main">
      <section style={{ paddingTop: 30 }}>
        <span className="eyebrow">
          {isListed(decoded) ? "Listed trust" : "Trust"} · Studionet
        </span>
        {/* The trust's own name, its address and its seal all come from views, so they
            belong to the record rather than to the shell. What is reserved here is only
            the space they will occupy — a page that reflows when data lands moves
            everything the reader has already looked at. No figure and no name is invented
            to fill it. */}
        <div className="skeleton skeleton-title" aria-hidden="true" />
        <div className="skeleton skeleton-address" aria-hidden="true" />
      </section>

      <TrustRecordView address={decoded} />

      <section style={{ marginTop: 48 }}>
        <div className="panel">
          <h3>Read another trust</h3>
          <p className="muted">
            Any address deployed from this contract. Listed ones are on{" "}
            <Link href="/trusts">the directory</Link>.
          </p>
          <AddressForm label="Trust address" />
        </div>
      </section>
    </main>
  );
}