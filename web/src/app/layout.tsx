import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fideicommis — audit",
  description:
    "An audit reader for an autonomous trust on GenLayer. Reads the contract's own view methods: conservation, the constitution, and the reasoning behind every decision.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0e1418",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to the record
        </a>
        {children}
      </body>
    </html>
  );
}
