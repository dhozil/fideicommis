import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
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

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
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
