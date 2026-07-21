---
"@real-a11y-dev/core": minor
---

Expose `<video>` / `<audio>` with real `video` / `audio` roles, mirroring Chromium's native accessibility tree.

ARIA defines no media roles and HTML-AAM says "no corresponding role", but that framing hid media elements behind `generic` — in the panel a named, captioned player was indistinguishable from a `<div>`, while Chrome DevTools shows a `Video "Product tour"` node. The extractor now sides with the browser's ground truth:

- `<video>` → role `video`, `<audio>` → role `audio` (explicit `role="…"` still wins).
- Media nodes are leaves: unrendered fallback content ("Sorry, your browser doesn't support…") and `<track>` / `<source>` metadata never become tree nodes, never leak into the accessible name, and never pollute the text preview. `<source>` inside `<picture>` is skipped too.
- The one a11y-critical signal that lived in the skipped children — does this media ship a captions or subtitles track? (WCAG 1.2.2) — is hoisted onto the media node as `properties.captions` (`"true"` / `"false"`).
- `<video controls>` / `<audio controls>` are reported focusable with a `focus` action, matching Chromium (the actual play/seek/volume controls live in a closed user-agent shadow root no in-page extractor can reach). `controls` / `autoplay` / `muted` / `loop` / `poster` now surface in the node's key attributes, and `DomObserver` watches the `controls` attribute so toggling native controls re-extracts.

Note: Playwright's `ariaSnapshot` omits media elements entirely (they have no ARIA role), so aria-snapshot output is unchanged; this aligns the DevTools-style full tree that the panel, extension, and serializers render.
