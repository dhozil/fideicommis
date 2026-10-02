"use client";

import Link from "next/link";
import { addressOnExplorer, shortAddress } from "@/lib/explorer";
import { gen } from "@/lib/format";
import type { FeaturedTrust, ListedTrust } from "@/lib/types";

/**
 * A card for one trust.
 *
 * This is a client component only because the explorer link and the card link are
 * both interactive, and nesting an anchor inside the card's own link is invalid
 * HTML. It could not have been solved by stopping the click: a server component
 * cannot pass an event handler to a client one, so the build refused it. The fix is
 * structural rather than a workaround, which is that the card is not the link. The
 * whole panel opens the record, and the address beneath it opens the explorer.
 */
/**
 * The figures are passed in rather than read here.
 *
 * `FeaturedTrust` comes from lib/featured.ts, which is server-only because it holds
 * the chain client. Importing that type into a client component is fine for the
 * erased type, but it is worth saying so, because importing the *value* would pull
 * the reader into the browser and the build would refuse it.
 */
export function TrustCard({ trust, live }: { trust: ListedTrust; live: FeaturedTrust }) {
  return (
    <article className="trust-card">
      <Link
        href={`/trust/${trust.address}`}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <h3>{live.reachable ? live.name : trust.purpose}</h3>
        <span className="faint" style={{ fontSize: "0.88rem", display: "block", marginBottom: 10 }}>
          {trust.purpose}
        </span>
        {live.reachable ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            <span className="data">{live.status}</span> ·{" "}
            <span className="data">{gen(live.treasury)} GEN</span> held ·{" "}
            <span className="data">runway {live.runway}</span> · charter{" "}
            <span className="data">v{live.charterVersion}</span>
          </p>
        ) : (
          <p className="faint" style={{ marginBottom: 0 }}>
            The node did not answer for this address just now. Open the record to try
            again.
          </p>
        )}
      </Link>

      <div className="addr">{trust.address}</div>
      <p className="faint" style={{ margin: 0, fontSize: "0.84rem" }}>
        {trust.note}
      </p>
      <p style={{ margin: "12px 0 0" }}>
        <a
          href={addressOnExplorer(trust.address)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {shortAddress(trust.address)} on the explorer
        </a>
      </p>
    </article>
  );
}
