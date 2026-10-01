import type { Metadata } from "next";
import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";
import { verify } from "@/lib/verify";
import { isAddress } from "@/lib/address";
import { FEATURED_TRUST } from "@/lib/registry";
import { addressOnExplorer } from "@/lib/explorer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Check it yourself",
  description:
    "Every view method this reader calls, what it uses the answer for, and the raw value it returned — so any claim here can be reproduced with a single call.",
};

/**
 * The page that makes the reader falsifiable.
 *
 * Every other page in this site is a claim about a trust, and every claim is a
 * paraphrase of a value the contract returned. That is only worth anything if a
 * stranger can obtain the same values, so this page lists the complete call surface:
 * which method, what the reader does with it, where it appears, and what it actually
 * returned just now.
 *
 * The point of showing raw return values rather than formatted figures is that a
 * table of the reader's own arithmetic only proves the reader can add up. `0xf22f`
 * and the address beside it are enough for anyone to reproduce it in their own
 * client, which is the whole point.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  const requested = (address ?? "").trim();
  const usable = isAddress(requested);
  const target = usable ? requested : FEATURED_TRUST;

  const report = usable ? await verify(target) : null;

  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">Check it yourself</span>
        <h1 style={{ maxWidth: "18ch" }}>
          Every figure here is one call away from you.
        </h1>
        <p className="lede" style={{ marginTop: 18 }}>
          This reader has one claim about itself: it holds no key, signs nothing, and
          every number it shows comes from a <code>get_*</code> method on the contract
          itself. That claim is only worth something if you can reproduce the numbers.
          Below is the complete call surface, and what each call returned just now.
        </p>
      </section>

      <section className="panel" style={{ marginTop: 32 }}>
        <AddressForm label="Whose trust do you want to check?" />
        {requested && !usable ? (
          <p className="notice bad" style={{ marginTop: 16 }}>
            <strong>That is not a contract address.</strong> A GenLayer address is{" "}
            <code>0x</code> followed by 40 hexadecimal characters, and nothing was
            called. Showing the reference trust instead, below.
          </p>
        ) : null}
      </section>

      {report ? (
        <>
          <section style={{ marginTop: 36 }}>
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "baseline",
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <h2 style={{ fontSize: "1.5rem" }}>
                {report.isTrust ? report.name : "Nothing answered at this address"}
              </h2>
              <span className={`mark ${report.isTrust ? "holds" : "broken"}`}>
                {report.isTrust ? "is a Fideicommis" : "not a Fideicommis"}
              </span>
              <a
                href={addressOnExplorer(target)}
                target="_blank"
                rel="noreferrer noopener"
                className="data"
                style={{ fontSize: "0.8rem", marginLeft: "auto" }}
              >
                {target} on the explorer →
              </a>
            </div>
            {!report.isTrust ? (
              <p className="notice bad">
                No contract answered at that address, or what answered is not one of
                these. If it is a Fideicommis that was deployed recently, it may not be
                readable on this network yet.
              </p>
            ) : null}
          </section>

          <section style={{ marginTop: 28 }}>
            <h3 style={{ marginBottom: 10 }}>
              {report.rows.length} methods, one request
            </h3>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              These were all called together. The millisecond figures are what a page
              load actually costs, which is why the reader batches rather than pacing
              calls one at a time.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Used for</th>
                    <th>Appears as</th>
                    <th className="num">ms</th>
                    <th>Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.method}>
                      <td>
                        <code>{row.method}</code>
                        {row.outcome === "failed" ? (
                          <div>
                            <span className="mark broken">failed</span>
                          </div>
                        ) : row.outcome === "empty" ? (
                          <div>
                            <span className="mark unknown">nothing yet</span>
                          </div>
                        ) : null}
                      </td>
                      <td style={{ color: "var(--ink-dim)", maxWidth: 260 }}>{row.used}</td>
                      <td style={{ color: "var(--ink-faint)", maxWidth: 180 }}>{row.shows}</td>
                      <td className="num">{row.ms || "—"}</td>
                      <td
                        className="data"
                        style={{
                          maxWidth: 420,
                          color: row.outcome === "failed" ? "var(--breach)" : "var(--ink-dim)",
                        }}
                      >
                        {row.error ?? row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginTop: 36 }}>
            <div className="notice warn" style={{ maxWidth: "72ch" }}>
              <strong>How to reproduce one of these.</strong> With any JSON-RPC client
              against <code>https://studio.genlayer.com/api</code>, send{" "}
              <code>gen_call</code> to the address above with{" "}
              <code>{"{ method: \"get_lifetime_flow\", args: [] }"}</code>. If you get
              the same buckets, this page is telling the truth about that figure. Note
              that a browser-like User-Agent is required, or Cloudflare answers with
              error 1010.
            </div>
            <p className="muted" style={{ marginTop: 18 }}>
              <Link href={`/trust/${target}`}>
                Open the full record for this trust →
              </Link>
            </p>
          </section>
        </>
      ) : (
        <section className="prose" style={{ marginTop: 40 }}>
          <h2>What this reader calls, and nothing else</h2>
          <p>
            There are twelve view methods in use, listed above with a live call. There
            is no method on this site that the table does not name, and a method not in
            the table is not called: that can be checked by looking for{" "}
            <code>get_</code> in <code>web/src/lib/</code>.
          </p>
          <p>
            It is also worth being precise about what that proves. It proves the
            figures come from the contract and not from this site. It does not prove
            the figures mean anything — the same limitation the rest of the reader
            states on its{" "}
            <Link href="/about">own limits page</Link>.
          </p>
        </section>
      )}
    </main>
  );
}
