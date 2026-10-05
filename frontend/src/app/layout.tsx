import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

/**
 * Three faces, each with one job.
 *
 * Plex Sans for prose, because a reader is read rather than scanned. Plex Mono for
 * data only — figures, addresses, hashes — which is the change that matters: the
 * previous build set mono as the body face, which is why a ledger full of numbers
 * ended up looking like a terminal instead of a document. Newsreader for the deed
 * voice: the charter, the rulebook, the headings that state a principle. It is a
 * high-contrast editorial serif, which is the register of a charter, and it is used
 * sparingly enough that it reads as an accent rather than a theme.
 */

/**
 * The faces, self-hosted rather than fetched.
 *
 * These were `next/font/google`, and CI could not build with them: Turbopack's Google-font
 * replacer could not resolve `@vercel/turbopack-next/internal/font/google/font`, which fails
 * the build outright. A cold build on this machine passes, so the cause is environmental and
 * was not reproduced here — but the resolution it could not perform is the same one every
 * build has to perform, and that is reason enough to stop needing it.
 *
 * Two things improve by removing it. The build no longer reaches a font CDN, so its output
 * does not depend on someone else's server being up — which matters more than usual for a
 * reader whose argument is that its figures can be checked. And a font that 404s on a
 * visitor's network degrades to the fallback instead of to nothing.
 *
 * All three are SIL Open Font Licence, which permits self-hosting, so the files belong in
 * the repository. Plex Sans and Newsreader are variable fonts: one file covers every weight,
 * so they are declared with a weight range rather than as separate faces. Plex Mono ships
 * static cuts, so its two weights are listed individually.
 *
 * The `latin` subset only. Google emits a file per subset and the previous build referenced
 * 46 of them across every script; the site is English, and shipping the rest would triple
 * the payload for glyphs it never renders.
 */

const plexSans = localFont({
  src: "./fonts/plex-sans-variable.woff2",
  weight: "100 700",
  style: "normal",
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Helvetica Neue", "sans-serif"],
});

const plexMono = localFont({
  src: [
    { path: "./fonts/plex-mono-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-mono-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
});

const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader-variable.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/newsreader-variable-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Fideicommis — an autonomous trust, audited from its own contract",
    template: "%s · Fideicommis",
  },
  description:
    "An autonomous trust on GenLayer, administered in perpetuity under its own charter and judged by a committee of validators. This reader shows the conservation identity, the constitution, and the reasoning behind every decision, read from the contract's own view methods.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a1114",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to the content
        </a>
        <SiteHeader />
        <div className="shell">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
