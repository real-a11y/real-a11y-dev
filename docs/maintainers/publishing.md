# Publishing Semantic Navigator to Chrome Web Store

## Context

The extension is technically complete and build-ready. This guide covers everything needed to go from a local build to a published Chrome Web Store listing.

**Extension package:** `packages/extension`
**Manifest:** `packages/extension/public/manifest.json`
**Build output:** `packages/extension/dist/`
**Current version:** 0.1.0

> The npm packages have their own publish flow via `.github/workflows/publish.yml` — see `@real-a11y-dev` organization on npm. This document covers only the Chrome extension.

---

## Step 1 — Build and zip

Everything on the code side is already in place. From the extension package:

```bash
pnpm --filter @real-a11y-dev/semantic-navigator-extension package
```

That runs `pnpm build` then produces `packages/extension/semantic-navigator-v<version>.zip` (uses the pure-Node zip script at `packages/extension/scripts/zip-for-cws.mjs` — no devDependency required).

### What's already wired up

| Item | Status |
|---|---|
| Manifest V3 | ✅ |
| Icons 16 / 48 / 128 | ✅ `packages/extension/public/icons/` |
| Minimal permissions (`activeTab`, `sidePanel`, `scripting`, `webNavigation`) | ✅ |
| `homepage_url` | ✅ Points to `https://real-a11y.dev` |
| Content script `<all_urls>` | ✅ Required for the tool to work on any page |
| BETA pill in side panel | ✅ Sets expectations during pre-1.0 |
| Zip script | ✅ `pnpm package` |

---

## Step 2 — Things you handle manually

### 2a. Chrome Web Store Developer Account

- Go to: https://chrome.google.com/webstore/devconsole
- One-time **$5 registration fee**
- Uses your Google account; 2FA required

### 2b. Privacy policy (required)

Chrome Web Store requires a privacy policy for any extension using `activeTab` + `scripting`, even if no data is collected.

**Already written:** `website/privacy.md` — published at `https://real-a11y.dev/privacy` once the site ships. It explicitly covers the Chrome extension, including a per-permission justification table.

Just point the CWS listing's "Privacy policy URL" field at `https://real-a11y.dev/privacy`.

### 2c. Store listing copy

**Short description** (132 chars max):

> Navigate and interact with any web page through its semantic DOM and accessibility tree. Built for developers and a11y pros.

**Detailed description** — draft to paste / edit before submitting:

> Semantic Navigator replaces the visual browser rendering with an interactive DOM and accessibility tree. It's built for developers, QA engineers, and accessibility consultants who need to experience a page the way assistive technology does.
>
> **What you can do:**
>
> - Explore the DOM tree or the computed accessibility tree in a side panel
> - Click, navigate, focus, submit, and toggle through the tree — no mouse on the page required
> - Watch the page's real focus highlighted live as you tab through it
> - Scope down to a single dialog, form, or landmark
> - Filter by role (links, buttons, headings, form fields, landmarks)
> - Inspect the tab order and catch missing or out-of-order focus targets
> - "Curtain" the page to audit purely from the semantic tree
>
> Built on the open-source Real A11y engine. The same tree extraction also powers our testing library, React hooks, and Storybook addon — see https://real-a11y.dev.
>
> Privacy: runs entirely in your browser. No data leaves your machine.

**Category:** `Developer Tools`

### 2d. Screenshots (required — minimum 1)

- Size: **1280×800** or 640×400 PNG/JPEG
- Minimum 1, maximum 5

Suggested shots:

1. A11Y tree view on a well-structured page
2. Interaction from the panel — e.g. clicking a combobox option
3. Focus sync tracking a real focused element on the page
4. Dialog scope indicator in action
5. Tab sequence view on a form

Take screenshots with DevTools closed and the side panel open at full height.

### 2e. Promotional images (optional)

- Small promo tile: **440×280** (shown in search results)
- Large tile: **920×680**
- Marquee: **1400×560** (featured placement)

Reuse the monochrome brand: black typography on a white background, echoing the `ra / dev` mark in `website/public/logo.svg`. The existing `website/public/og-image.svg` (1200×630) is a reference layout — crop or re-derive the promotional tiles from the same design.

---

## Step 3 — Submission

1. Run `pnpm --filter @real-a11y-dev/semantic-navigator-extension package` → produces `semantic-navigator-v0.1.0.zip`
2. Go to [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole) → **New Item**
3. Upload `semantic-navigator-v0.1.0.zip`
4. Fill in: description, screenshots, privacy policy URL (`https://real-a11y.dev/privacy`), category
5. Set **Visibility**: Public
6. **Single purpose declaration:** "Inspect and interact with the accessibility tree of web pages."
7. **Permission justifications** (Google will ask for each):
   - `activeTab` — read the current page's DOM to build the semantic tree
   - `sidePanel` — the extension's UI lives in the side panel
   - `scripting` — inject the content script that extracts the tree
   - `webNavigation` — detect iframe lifecycle to merge their trees
8. Submit for review

**Review time:** Typically 1–3 business days. Extensions using `scripting` + `activeTab` may trigger manual review (up to 7 days).

---

## Verification

- After build: open `packages/extension/dist/manifest.json` and confirm `homepage_url` is present
- Test the zip: extract `semantic-navigator-v<version>.zip` and load in Chrome via `chrome://extensions` → Load unpacked — verify all features work
- Before submit: use Chrome's pre-publish validator in the Developer Console (flags missing fields)
- After publish: install from Web Store in a clean Chrome profile and test end-to-end
