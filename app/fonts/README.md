# Fonts

Self-hosted so nothing at build or run time fetches from Google
(`app/layout.tsx`, `next/font/local`). Both are under the SIL Open Font
License 1.1; each directory carries its `OFL.txt`.

| File | Source | Version | Built as |
|---|---|---|---|
| `oswald/Oswald.woff2` | `google/fonts` `ofl/oswald/Oswald[wght].ttf` | 4.103 | variable, `wght` limited to 400–700 |
| `inter/Inter.woff2` | `google/fonts` `ofl/inter/Inter[opsz,wght].ttf` | 4.001 | variable, `opsz` pinned at 14, `wght` 100–900 |

These match what Google Fonts served the app through `next/font/google`
until 2026-11-05: the same font versions and axes, subset (fontTools) to
exactly the union of the characters in every subset Google served
(latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese:
803 code points for Oswald, 1622 for Inter). One file per family, because
`next/font/local` can't give each file its own `unicode-range`.
