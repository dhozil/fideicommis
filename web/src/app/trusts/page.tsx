import type { Metadata } from "next";
import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";
import { TrustCard } from "@/components/TrustCard";
import { readFeatured } from "@/lib/featured";
import { LISTED_TRUSTS } from "@/lib/registry";

// This page reads the node, so it is a snapshot rather than a build artefact.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Trusts",
  description:
    "The directory of Fideicommis trusts this reader knows about, plus a way to open any address deployed from the same contract.",
};

/**
 * A directory, not a registry with authority.
 *
 * This used to be on-chain state owned by one address, which was removed along with
 * the factory that held it. A list of where to look is worth keeping; a list that
 * some key controls is the same capture as everything else this project is about.
 * Each entry is read live, so a stale line here shows as stale rather than being
 * repeated as fact.
 */
export default async function TrustsPage() {
  const rows = await Promise.all(
    LISTED_TRUSTS.map(async (trust) => ({ trust, live: await readFeatured(trust.address) })),
  );

  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">The directory</span>
        <h1 style={{ maxWidth: "16ch" }}>Trusts deployed from this contract.</h1>
        <p className="lede" style={{ marginTop: 18 }}>
          A short list, kept in this repository rather than on chain, so that changing
          it is an ordinary reviewable commit instead of an act of governance. Every
          figure below is read live from the trust itself.
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <div className="grid-two">
          {rows.map(({ trust, live }) => (
            <TrustCard key={trust.address} trust={trust} live={live} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <div className="panel">
          <h3>Not listed here</h3>
          <p className="muted">
            A trust deployed by anyone does not need to be in this list. Paste the
            address and the reader will take it from there, exactly as it treats the
            ones above.
          </p>
          <AddressForm label="Any other trust address" />
        </div>
      </section>
    </main>
  );
}
