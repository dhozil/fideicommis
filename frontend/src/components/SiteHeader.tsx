"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The wordmark carries a small seal glyph. It is the one piece of ornament in the
 * reader, and it earns its place because a trust is a sealed instrument and this
 * page is a reader for one. Nothing else on the site is decorated.
 */

function Seal() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      {/* an open ledger: two leaves with a gap at the spine */}
      <path
        d="M10 5.4v9.2M10 5.4C8.7 4.5 7.1 4.3 5.2 4.6v9.2c1.9-.3 3.5-.1 4.8.8 1.3-.9 2.9-1.1 4.8-.8V4.6c-1.9-.3-3.5-.1-4.8.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

const LINKS = [
  { href: "/trusts", label: "Trusts" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/verify", label: "Check it yourself" },
  { href: "/about", label: "What this is" },
];

export function SiteHeader() {
  const pathname = usePathname();

  const current = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="wordmark" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--brass)", display: "flex" }}>
            <Seal />
          </span>
          Fideicommis
        </Link>
        {/* The network is stated in the chrome, on every page, because every figure
            on this site came from that one node and a reader should never have to go
            looking for where. */}
        <span className="seal site-net">Studionet · read-only</span>
        <nav className="site-nav" aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
