# Website public assets

Files in this directory are served at the site root.

## Current placeholders (replace before / soon after launch)

| File | Status | Notes |
|------|--------|-------|
| `logo.svg` | **Placeholder** | Rounded-square mark in brand blue (`#2e79ff`) with a stylized tree. Replace with final artwork. |
| `favicon.svg` | **Placeholder** | Same mark, optimized for small sizes. |
| `og-image.svg` | **Placeholder** | 1200×630 social card. **Note:** the VitePress config references `/og-image.png`, because most social scrapers prefer PNG for OG images. Export this SVG to PNG at 1200×630 and drop it in as `og-image.png` before announcing. Until then, scrapers may render the SVG inconsistently. |
| `CNAME` | Configured | Set to `real-a11y.dev` for GitHub Pages custom-domain deploy. |
| `robots.txt` | Configured | Allow all; points at `sitemap.xml`. |

## Missing (create when you have final art)

- `og-image.png` — PNG export of `og-image.svg` at 1200×630
- `apple-touch-icon.png` — 180×180 PNG for iOS home-screen shortcuts
- Additional PNG icon sizes if you need them (16, 32, 48, 64, 128, 256, 512, 1024)

## Brand colors

- Primary blue: `#2e79ff`
- Dark gradient start: `#0f1a33`
- Dark gradient end: `#1a2a55`
- Beta pill amber: `#f5b700` on `#1a1200` text
