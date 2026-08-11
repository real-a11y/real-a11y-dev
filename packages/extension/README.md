# Semantic Navigator — Chrome Extension

Chrome extension that adds a Side Panel with an interactive DOM/accessibility tree view for any web page.

## Installation

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom).

> **Note on the install warning.** Chrome may show *"Proceed with caution — not trusted by Enhanced Safe Browsing"* before install. ESB classifies new extensions as untrusted by default until Google's systems have built enough signal on the listing; the notice is unrelated to anything specific in this extension. Click **Continue to install**.

## Installation (from source)

1. Clone the [monorepo](https://github.com/real-a11y/real-a11y-dev) and build the extension:
   ```bash
   git clone https://github.com/real-a11y/real-a11y-dev.git
   cd real-a11y
   pnpm install
   pnpm --filter @real-a11y-dev/semantic-navigator-extension build
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `packages/extension/dist` directory
5. Navigate to any web page and click the Semantic Navigator icon in the toolbar

## How it works

### Architecture

```
Side Panel (Preact UI)
    ↕ chrome.runtime messages
Background Service Worker
    ↕ chrome.tabs messages
Content Script (runs in page context)
    ↕ DOM APIs
Web Page
```

- **Content Script** — Injected into every page. Extracts the DOM/accessibility tree using `@real-a11y-dev/core`, dispatches actions on real DOM elements, manages the highlight overlay, and applies native Tab / Escape defaults for the panel keyboard bar (Tab reuses core `getTabSequence`; synthetic key events alone cannot move focus or close `<dialog>`).
- **Background Service Worker** — Routes messages between the Side Panel and content scripts, and merges each frame's tree into one. Because that per-frame state is in memory only, it also originates traffic of its own: when Chrome restarts it under a loaded page it asks frames it has no tree for to re-announce, so the panel doesn't lose its iframe subtrees. Manages the Side Panel lifecycle. Panel→content commands carry the panel's bound `tabId`; the background prefers that over its global `activeTabId` so a tab-switch race cannot land `DISPATCH_ACTION` / `SEND_KEY` / `CLOSE_TAB` on the newly active tab while the panel still shows the previous tab's nodes.
- **Side Panel** — Renders the tree UI. Receives serialized tree data from the content script and sends action commands back. A **Copy ▾** dropdown exports the current view to the clipboard as a paste-ready Markdown accessibility report — Everything, the A11y/DOM tree, the heading outline, or the tab sequence — for dropping into a bug tracker. The keyboard bar (`Esc` · `Tab` · `Shift+Tab` · `Enter` · `Space` · `↑` · `↓`) sends keys to the focused page element.

### Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current tab's DOM for tree extraction |
| `sidePanel` | Register and open the Side Panel UI |
| `webNavigation` | Detect SPA route changes so the tree refreshes when the page does |

The content script is declared in the manifest with `<all_urls>` and `all_frames: true` so the tree is ready the moment the user opens the side panel. No data leaves your browser; the extension makes no network requests.

Chrome still blocks content scripts outright on some pages — `chrome://` pages (including the default new-tab page), the Chrome Web Store, and the built-in PDF viewer. A panel→content broadcast there reaches no frame, and the background reports that back (`{ success: false, error: "restricted-page" }`) rather than claiming delivery. Any tree request that comes back that way — the panel's first load, the `↻` refresh, **Load tree** — puts the panel in a **This page can't be inspected** state instead of leaving it waiting on a tree that can never arrive.

Reaching such a page by switching tabs or by navigating does not show that message on its own; it empties the panel first. A tree only ever reaches the panel because a frame announced one, and on these pages none ever will, so the background pushes `PAGE_NAVIGATED` on every top-frame navigation and the panel drops what it holds. Keeping the old tree would be worse than an empty one: node ids are a per-frame counter, so its rows resolve to unrelated elements on the new page while staying clickable. From there **Load tree** answers honestly.

### Content Security Policy

`extension_pages` is locked to `script-src 'self'; object-src 'self'; base-uri 'self'` — the side panel cannot load remote scripts, embed `<object>`/`<embed>` from third parties, or be re-based to a different origin. See `public/manifest.json`.

### Versioning

`public/manifest.json`'s `version` is the source of truth shipped to the Chrome Web Store. It's kept in sync with `package.json` automatically by `scripts/sync-manifest-version.mjs`, which runs as `prebuild`. CI runs the same script with `--check` (via `pnpm typecheck`) and fails if the two have drifted.

## Development

```bash
# Build the extension
pnpm --filter @real-a11y-dev/semantic-navigator-extension build

# Watch mode
pnpm --filter @real-a11y-dev/semantic-navigator-extension dev
```

After rebuilding, click the refresh icon on `chrome://extensions` to reload.

## License

MIT
