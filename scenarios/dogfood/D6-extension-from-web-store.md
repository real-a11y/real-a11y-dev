---
id: D6
suite: dogfood
scenario: "Chrome extension from the Web Store — real-world sites, real user flow"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.8, and only once the Chrome Web Store listing shows the submitted version. Store build only — an unpacked local build makes this Blocked, not Pass"
validUntil: ""
expected: "the STORE build (not a local unpacked one) installs and works across a docs site, an SPA, and a real form — including perf on a heavy page"
twin:
  - R17
  - R18
  - R42
notion: "https://app.notion.com/p/3aa1c354b0b581aea7eae887241ecaf8"
---

## Steps

Install from the **Chrome Web Store**, not an unpacked local build. If the store listing hasn't
updated yet, this row is **Blocked**, not Pass — a local build is a different artifact
(unminified, different permissions prompt, no store review pass).

1. Install from the store listing; note the version shown
2. Confirm it matches the version just submitted
3. Read the permissions prompt as a first-time user would
   - **3b** — from the first release after 0.1.15. Open the side panel on any
     ordinary page: with nothing asked first, it reads Chrome's own tree, and
     Chrome's bar appears while it reads, naming the extension the way the listing
     does (“Semantic Navigator” started debugging this browser). A note below the
     toolbar explains the bar: press **Got it**. Steps 4–9 run on the native tree;
     **Show** in **Settings ▾** switches to the in-page tree, and step 7 holds on
     both. **R42** is the full version of this step
4. **A docs site** — long content, many headings: open the panel, browse the tree, use search
5. **An SPA** — client-side routes: navigate, confirm the panel follows; use Back
6. **A real form** — click, type, toggle; confirm the page's own handlers ran
7. On that form, focus a **password** field and type — check every panel view
8. **A heavy page** — a large table or an infinite feed: is the panel usable, or does it stall?
9. Keyboard-only pass, with a screen reader running
10. Leave it installed and browse normally for a while

## Expected

- The **store build** installs and works — minification and the store's packaging step are both
  in play here and neither is exercised locally
- The version matches what was submitted
- **3b** — the panel reads the native tree with nothing asked first, Chrome's bar
  names the extension, and the note explains the bar
- Panel works across all three site shapes; SPA routes and Back are followed
- Real handlers fire on the form
- **The password value never appears**, in any view
- The heavy page stays usable
- Keyboard + screen reader work (see **R17** for the detail)
- **10** — no console noise, no memory growth, no breakage of the sites themselves

## Why this exists

This is the only check of the artifact users actually receive. Web Store packaging, minification
and review can all change behaviour relative to `dist/`, and the pre-publish row (**R17**) can't
see any of it.

Step 10 is easy to skip and worth doing: an extension that leaks memory or breaks a site's own JS
after twenty minutes passes every scripted check and gets uninstalled anyway.

Step 7 is the same absolute rule as everywhere else — no view, no debug mode, no error path may
show a password.

Step 3b is `chrome.debugger` as a store user meets it: the permission prompt in step 3 is
Chrome's, the note about the bar is the extension's, and the bar's wording comes from the store
build's own name, so only the listed artifact shows all three together.
