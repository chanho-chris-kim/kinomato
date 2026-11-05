import type { Metadata } from "next";

// Site-wide link-preview defaults (rebuild step 5e). Next merges metadata
// shallowly, so a page that sets its own openGraph replaces the layout's
// whole object: spread DEFAULT_OPEN_GRAPH to keep the image.

export const DEFAULT_TITLE = "Kinomato — Whose turn is it?";

export const DEFAULT_DESCRIPTION =
  "Kinomato keeps a friend group's movie night going: everyone keeps a watchlist, you take turns picking, and the club votes.";

// public/og-default.png, made by scripts/og-image.mjs. Relative: the root
// layout's metadataBase (the request's own host) makes it absolute. A
// static image because the Workers free plan can't carry next/og.
export const OG_IMAGE = { url: "/og-default.png", width: 1200, height: 630, alt: "Kinomato — Whose turn is it?" };

export const DEFAULT_OPEN_GRAPH: NonNullable<Metadata["openGraph"]> = {
  type: "website",
  siteName: "Kinomato",
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  images: [OG_IMAGE],
};
