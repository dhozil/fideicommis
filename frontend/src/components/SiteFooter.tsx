import Link from "next/link";
import { EXPLORER_URL } from "@/lib/explorer";

/**
 * The colophon states what the reader is and is not, on every page, because the
 * strongest claim this application makes is negative: it signs nothing, holds no key,
 * and has no write path. A reader that cannot be trusted to say that about itself is
 * not worth trusting about a trust.
 *
 * It is laid out across the full width of the shell rather than tucked into a narrow
 * column, because a caveat in the corner is a caveat nobody reads. The claim gets the
 * wide column, the way out of here gets the narrow one, and the provenance line runs
 * underneath both.
 */

export function SiteFooter() {
  return (
    <footer className="colophon">
      <div className="colophon-inner">
        <div className="colophon-claim">
          <span className="read-only">Read-only</span>
          <p style={{ margin: "14px 0 0" }}>
            Every figure this site shows is a call to a trust&apos;s own{" "}
            <code>get_*</code> method, so any claim here can be checked by making the
            same call. Nothing on this site is signed, no account is used for reads,
            and there is no private key in the build.
          </p>
        </div>

        <nav className="colophon-nav" aria-label="Footer">
          <span className="eyebrow" style={{ marginBottom: 4 }}>
            Keep reading
          </span>
          <Link href="/how-it-works">How a trust works</Link>
          <Link href="/verify">Check it yourself</Link>
          <Link href="/about">What this is, and what it is not</Link>
          <Link href="/trusts">The directory</Link>
        </nav>

        <div className="colophon-note">
          <a href={EXPLORER_URL} rel="noreferrer noopener" target="_blank">
            Studionet explorer
          </a>
          <span>Built on GenLayer, with the pinned runner</span>
          <span>One contract, one file, no factory</span>
        </div>
      </div>
    </footer>
  );
}