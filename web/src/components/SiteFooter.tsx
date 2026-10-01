import Link from "next/link";
import { EXPLORER_URL } from "@/lib/explorer";

/**
 * The colophon states what the reader is and is not, on every page, because the
 * strongest claim this application makes is negative: it signs nothing, holds no
 * key, and has no write path. A reader that cannot be trusted to say that about
 * itself is not worth trusting about a trust.
 */

export function SiteFooter() {
  return (
    <footer className="colophon">
      <span className="read-only">Read-only</span>
      Every figure this site shows is a call to a trust&apos;s own <code>get_*</code>{ " "}
      method, so any claim here can be checked by making the same call. Nothing on
      this site is signed, no account is used for reads, and there is no private key
      in the build.
      <div style={{ marginTop: 18, display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Link href="/how-it-works">How a trust works</Link>
        <Link href="/verify">Check it yourself</Link>
        <Link href="/about">What this is, and what it is not</Link>
        <Link href={EXPLORER_URL} rel="noreferrer noopener" target="_blank">
          Studionet explorer
        </Link>
        <span className="faint">GenLayer, Studionet</span>
      </div>
    </footer>
  );
}
