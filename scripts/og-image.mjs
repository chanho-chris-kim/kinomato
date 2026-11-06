// Renders public/og-default.png, the link-preview image every page shares
// (rebuild step 5e). 1200×630, the "late show" theme's colours
// (app/globals.css), the wordmark in the display face (Oswald 500) and
// "Whose turn is it?".
//
// A static image because the Workers free plan can't carry next/og: a
// generated per-invite image measured +823 KiB gzipped on the Worker
// (docs/onboarding-spec.md §8.5).
//
// Run: node scripts/og-image.mjs
// Dev only. It renders with the app's own self-hosted Oswald
// (app/fonts/oswald/Oswald.woff2, embedded as a data URL), so nothing is
// fetched from anywhere. Commit the PNG it writes.
import { chromium } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/og-default.png", import.meta.url));
const OSWALD = readFileSync(new URL("../app/fonts/oswald/Oswald.woff2", import.meta.url)).toString("base64");

const html = `<!doctype html>
<html><head>
<style>
  @font-face {
    font-family: Oswald; font-weight: 400 500; font-display: block;
    src: url(data:font/woff2;base64,${OSWALD}) format("woff2");
  }
  html, body { margin: 0; }
  body {
    width: 1200px; height: 630px; box-sizing: border-box;
    background: #14100e; color: #f0e6d6;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 110px;
    border-bottom: 10px solid #e8a33d;
  }
  .wordmark {
    font-family: Oswald, Impact, sans-serif; font-weight: 500;
    letter-spacing: 0.02em; font-size: 176px; line-height: 1;
  }
  .line {
    font-family: Oswald, Impact, sans-serif; font-weight: 500;
    letter-spacing: 0.02em; font-size: 72px; line-height: 1.1;
    color: #e8a33d; margin-top: 30px;
  }
</style></head>
<body>
  <div class="wordmark">Kinomato</div>
  <div class="line">Whose turn is it?</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check('500 72px "Oswald"'));
  if (!ok) throw new Error("Oswald didn't load; refusing to write an image in a fallback face.");
  await page.screenshot({ path: OUT, type: "png" });
} finally {
  await browser.close();
}
const kb = statSync(OUT).size / 1024;
console.log(`Wrote ${OUT} (${kb.toFixed(1)} KB)`);
if (kb > 300) throw new Error("og-default.png is over 300 KB");
