import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import type { ReactNode } from "react";
import { getBaseUrl } from "@/app/baseUrl";
import { DEFAULT_DESCRIPTION, DEFAULT_OPEN_GRAPH, OG_IMAGE } from "@/app/metadata";
import "./globals.css";

// Oswald for display headings (h-display), Inter for everything else —
// docs/prototype.html's "late show" theme. Weight 500 is the one the
// theme's --display-w token actually uses; 400 covers the odd default.
const oswald = Oswald({
  variable: "--font-oswald",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  weight: ["400", "500"],
  subsets: ["latin"],
});

// metadataBase is the request's own host (app/baseUrl.ts), never a
// hardcoded domain: dev.kinomato.com, a *.workers.dev preview and
// localhost each get og:image URLs that point back at themselves.
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
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </footer>
      </body>
    </html>
  );
}
