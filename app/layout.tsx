import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import type { ReactNode } from "react";
import { getBaseUrl } from "@/app/baseUrl";
import { DEFAULT_DESCRIPTION, DEFAULT_OPEN_GRAPH, OG_IMAGE } from "@/app/metadata";
import "./globals.css";

// Oswald for display headings (h-display), Inter for everything else —
// docs/prototype.html's "late show" theme. Self-hosted (app/fonts/README.md)
// so neither the build nor the site ever fetches from Google. Variable
// files, declared at the weights the app used through next/font/google
// (400 and 500; the theme's --display-w is 500), so weight matching is
// unchanged.
const oswald = localFont({
  src: "./fonts/oswald/Oswald.woff2",
  weight: "400 500",
  variable: "--font-oswald",
});

const inter = localFont({
  src: "./fonts/inter/Inter.woff2",
  weight: "400 500",
  variable: "--font-inter",
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await getBaseUrl()),
    title: "Kinomato",
    description: DEFAULT_DESCRIPTION,
    openGraph: DEFAULT_OPEN_GRAPH,
    twitter: { card: "summary_large_image", images: [OG_IMAGE] },
  };
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="late"
      className={`${oswald.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="tiny dim p-4">
          <nav aria-label="Legal" className="row gap8" style={{ marginBottom: 4 }}>
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/terms" className="underline">
              Terms
            </Link>
          </nav>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </footer>
      </body>
    </html>
  );
}
