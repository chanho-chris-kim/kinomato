# Fonts

Self-hosted so nothing at build or run time fetches from Google
(`app/layout.tsx`, `next/font/local`). Both are under the SIL Open Font
License 1.1; each directory carries its `OFL.txt`.

| File | Source | Version | Built as |
|---|---|---|---|
| `oswald/Oswald.woff2` | `google/fonts` `ofl/oswald/Oswald[wght].ttf` | 4.103 | variable, `wght` limited to 400–700 |
| `inter/Inter.woff2` | `google/fonts` `ofl/inter/Inter[opsz,wght].ttf` | 4.001 | variable, `opsz` pinned at 14, `wght` 100–900 |

Same font versions and axes Google Fonts served the app through
`next/font/google` until 2026-11-05, subset (fontTools) to Google's
**latin + latin-ext** `unicode-range`s only — the ranges Google's own
CSS gives those two subsets, identical for both families:

| File | Code points | Size |
|---|---|---|
| `oswald/Oswald.woff2` | 483 | 30,832 bytes |
| `inter/Inter.woff2` | 1,003 | 135,520 bytes |

Anything outside those ranges (Cyrillic, Greek, Vietnamese-specific
letters) falls back to the system font: a ruling on size (2026-11-05), not
an oversight. One file per family, because `next/font/local` can't give
each file its own `unicode-range`, so a Latin page downloads both files
whole, 166,352 bytes on a first visit.
