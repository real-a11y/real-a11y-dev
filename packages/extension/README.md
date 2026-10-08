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
- **Side Panel** — Renders the tree UI. Receives serialized tree data from the content script and sends action commands back. A **Copy ▾** dropdown exports the current view to the clipboard as a paste-ready Markdown accessibility report — Everything, the A11y/DOM tree, the heading outline, or the tab sequence — for dropping into a bug tracker. On the native tree it offers Everything, the native tree and Headings (no tab sequence: Chromium's tree has no tab order); every report's header names the producer that built it. The keyboard bar (`Esc` · `Tab` · `Shift+Tab` · `Enter` · `Space` · `↑` · `↓`) sends keys to the focused page element. Native mode, which the panel offers the first time it connects to a page and the **"Enable native mode…"** button turns on later, switches the producer to Chromium's own accessibility tree over `chrome.debugger` instead of the content script's DOM walk — see Native mode below.

### Permissions

| Permission      | Why                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`     | Access the current tab's DOM for tree extraction                                                                                                                |
| `sidePanel`     | Register and open the Side Panel UI                                                                                                                             |
| `webNavigation` | Detect SPA route changes so the tree refreshes when the page does                                                                                               |
| `debugger`      | Powers native mode (below): reads and acts on Chromium's own accessibility tree over CDP. Required by the manifest for every install — `chrome.debugger` cannot be an optional Chrome permission — but inert until a user explicitly turns native mode on. |
| `tabs`          | Lets native mode read the URL of the tab the side panel is bound to, to tell whether Chrome lets the debugger attach there (it can't on `chrome://` pages or the Web Store) and whether the page has navigated since the tree was read. Chrome has no way to grant `tabs` for a single tab, so this is technically broader than that use (it could read the URL and title of any open tab); the code reads only the bound tab's, and never enumerates others |
| `storage`       | Persists the native-mode on/off setting locally. While native mode is attached, it also keeps content-free bookkeeping about that attachment (which tab, since when) for the browser session only |

The content script is declared in the manifest with `<all_urls>` and `all_frames: true` so the tree is ready the moment the user opens the side panel. No data leaves your browser; the extension makes no network requests.

### Native mode

The suggested default, asked about before anything attaches. The side panel's own DOM/A11Y tree (above) is this extension's own in-page ARIA/AccName walk; native mode instead reads **Chromium's own** accessibility tree over `chrome.debugger` — the same protocol DevTools uses — which sees things the DOM walk can't (UA-shadow content like native media controls) at the cost of Chrome's bar reading “Semantic Navigator” started debugging this browser, shown across every window while attached. The first time the side panel connects to a page it asks, with **Use native mode** offered first and **Keep the DOM tree** as the other answer; either one is remembered, and **Enable native mode…** asks again later. Turning it back off detaches as soon as any read or action already under way finishes. See `DOGFOOD.md` for the exercise that validated shipping this, and [Two producers](https://real-a11y.dev/guide/core-concepts#two-producers) for how the DOM and native producers relate.

Once it's on, each time you open the side panel it shows the native tree for the first page that connects, with no click: that first page attaches the debugger by itself. After that, switching tabs doesn't attach on its own; the native tree's ↻ button or the NATIVE toggle reads the new tab. If native mode can't read that first page (DevTools already has it open, say), the panel stays on the DOM tree, says why, and tries the next tab you switch to instead.

Once a read has succeeded on a tab, the native tree follows that tab across navigations: the new page is read once, after its content script reports it. Other page changes wait for ↻, an action or a sent key, unless **Follow page changes** is on (the native toolbar's ⟳ toggle, `settings.nativeFollowPageChanges` in `chrome.storage.local`); then every burst of top-frame changes is read once the page goes quiet, backing off the longer it runs without the user. `src/sidepanel/native-auto-refresh.ts` holds the policy. A tab switch disarms it until ↻, and so does a failed read, so a refusal is never answered by another attach. The user's **Cancel** on Chrome's debugging bar pauses it whatever it interrupted — a pick, an action, a refresh — because the background refuses automatic reads on that tab until the user reads it again; that pause lives in the service worker's memory and lapses if Chrome restarts it.

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
