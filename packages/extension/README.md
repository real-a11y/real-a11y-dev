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

- **Content Script** — Injected into every page, and every frame of it. Extracts the DOM/accessibility tree using `@real-a11y-dev/core`, dispatches actions on real DOM elements, manages the highlight overlay, and applies native Tab / Escape defaults for the panel keyboard bar (Tab reuses core `getTabSequence`; synthetic key events alone cannot move focus or close `<dialog>`). A page can replace its document without navigating (`document.open()`, which is how a blank frame gets its content): that detaches the root element the tree is read from and removes every listener the script had, so the script binds to the document again whenever its root element changes, and draws the screen curtain again if it was up.
- **Background Service Worker** — Routes messages between the Side Panel and content scripts, and merges each frame's tree into one, each under the `<iframe>` that holds the frame. A frame of its parent's origin says which that is itself (see Frames with no URL of their own below); any other is matched by comparing its URL with each `<iframe>`'s `src`. Because that per-frame state is in memory only, it also originates traffic of its own: when Chrome restarts it under a loaded page it asks frames it has no tree for to re-announce, so the panel doesn't lose its iframe subtrees. Manages the Side Panel lifecycle. Panel→content commands carry the panel's bound `tabId`; the background prefers that over its global `activeTabId` so a tab-switch race cannot land `DISPATCH_ACTION` / `SEND_KEY` / `CLOSE_TAB` on the newly active tab while the panel still shows the previous tab's nodes.
- **Side Panel** — Renders the tree UI. Receives serialized tree data from the content script and sends action commands back. A **Copy ▾** dropdown exports the current view to the clipboard as a paste-ready Markdown accessibility report — Everything, the A11y/DOM tree, the heading outline, or the tab sequence — for dropping into a bug tracker. On the native tree it offers Everything, the native tree and Headings (no tab sequence: Chromium's tree has no tab order); every report's header names the producer that built it. The keyboard bar (`Esc` · `Tab` · `Shift+Tab` · `Enter` · `Space` · `↑` · `↓`) sends keys to the focused page element. Native mode, on by default and turned off in **Settings ▾**, switches the producer to Chromium's own accessibility tree over `chrome.debugger` instead of the content script's DOM walk — see Native mode below.

### Permissions

| Permission      | Why                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`     | Access the current tab's DOM for tree extraction                                                                                                                |
| `sidePanel`     | Register and open the Side Panel UI                                                                                                                             |
| `webNavigation` | Detect SPA route changes so the tree refreshes when the page does                                                                                               |
| `debugger`      | Powers native mode (below): reads and acts on Chromium's own accessibility tree over CDP. Required by the manifest for every install, since `chrome.debugger` cannot be an optional Chrome permission. Native mode is on by default and attaches only while the side panel reads or acts on the page it shows; turned off in the panel's Settings, it never attaches. |
| `tabs`          | Lets native mode read the URL of the tab the side panel is bound to, to tell whether Chrome lets the debugger attach there (it can't on `chrome://` pages or the Web Store) and whether the page has navigated since the tree was read. Chrome has no way to grant `tabs` for a single tab, so this is technically broader than that use (it could read the URL and title of any open tab); the code reads only the bound tab's, and never enumerates others |
| `storage`       | Persists the side panel's settings locally: whether native mode is on, **Follow page changes**, and whether the note about Chrome's debugging bar was dismissed. While native mode is attached, it also keeps content-free bookkeeping about that attachment (which tab, since when) for the browser session only |

The content script is declared in the manifest with `<all_urls>` and `all_frames: true` so the tree is ready the moment the user opens the side panel. No data leaves your browser; the extension makes no network requests.

### Frames with no URL of their own

The content script's `match_about_blank: true` also runs it in the `about:blank` and `srcdoc` frames of a page it runs in, and so in the frames a script writes into, which is how rich-text editors and many ad slots are built. It changes which frames get the script and nothing about what the extension may access: Chrome derives an extension's host access, and the install warning, from `matches` alone, so this adds no permission and no re-consent on update.

`match_origin_as_fallback` is deliberately not set. It would add sandboxed frames without `allow-same-origin`, and `data:` and `blob:` frames, and those can't be placed: their origin is their own, so a script there can't reach the `<iframe>` that holds its frame, and Chrome's `webNavigation` lists no `blob:` frame at all. No content script runs in them, the in-page tree shows their `<iframe>` with nothing inside, and Focus sync doesn't follow focus into them. Chrome's tree still reads them.

Nothing in a URL tells these frames apart. They all show `about:blank` or `about:srcdoc`, their `<iframe>`s carry no `src`, and a frame a script wrote into reports the URL of the document that wrote it. So each frame's content script marks the element holding its frame, and the script of the document around it reads the mark off that element (`src/frame-owner.ts`). A frame of its parent's origin can read `window.frameElement`, and one extension's content scripts see the same object for the same element in every frame of an origin, so a property set on it by one is there for the other. Page script has objects of its own for the page's elements and never sees it, and nothing reaches the DOM. The mark goes with a frame's tree (`FRAME_TREE_DATA`), with the nodes of its tree that bear one, and the merge places a marked frame by its mark alone. A marked element the tree has no node for, as the a11y view has none for a hidden `<iframe>`, is reported with no node, and its frame stays out of the tree. A frame whose mark no tree bears yet is never placed by a guess. The tree of the document around it usually arrives within moments, as a page that adds a frame changes; when none has after a second and a half, the service worker asks that document for its tree again, once.

### Native mode

On by default. The side panel's own DOM/A11Y tree (above) is this extension's own in-page ARIA/AccName walk; native mode instead reads **Chromium's own** accessibility tree over `chrome.debugger` — the same protocol DevTools uses — which sees things the DOM walk can't (UA-shadow content like native media controls) at the cost of Chrome's bar reading “Semantic Navigator” started debugging this browser, shown across every window while attached. The first time the panel reads a page this way, a one-time note explains that bar, with **Got it** and **Turn off**. **Settings ▾** → **Read pages through Chrome (recommended)** turns it off or back on later, in every window's side panel at once: the setting is `settings.nativeModeEnabled` in `chrome.storage.local`, and it reads as on unless it is `false`. While it is on, **Show** below it switches this panel between **Chrome's tree** and the **In-page tree**, whose DOM / A11Y / TAB views are in the toolbar; that choice is per panel, and not stored. Turning it off detaches as soon as any read or action already under way finishes. See `DOGFOOD.md` for the exercise that validated shipping this, and [Two producers](https://real-a11y.dev/guide/core-concepts#two-producers) for how the DOM and native producers relate.

With it on, each time you open the side panel it shows the native tree for the first page that connects, with no click: that first page attaches the debugger by itself. After that, switching tabs doesn't attach on its own; the native tree's ↻ button reads the new tab, as does choosing **Chrome's tree** in Settings from the in-page tree. If native mode can't read that first page (DevTools already has it open, say), the panel stays on the in-page tree, says why, and tries the next tab you switch to instead.

Once a read has succeeded on a tab, the native tree follows that tab across navigations: the new page is read once, after its content script reports it. Other page changes wait for ↻, an action or a sent key, unless **Follow page changes** is on (the native toolbar's ⟳ toggle, `settings.nativeFollowPageChanges` in `chrome.storage.local`); then every burst of top-frame changes is read once the page goes quiet, backing off the longer it runs without the user. `src/sidepanel/native-auto-refresh.ts` holds the policy. A tab switch disarms it until ↻, and so does a failed read, so a refusal is never answered by another attach. The user's **Cancel** on Chrome's debugging bar pauses it whatever it interrupted — a pick, an action, a refresh — because the background refuses automatic reads on that tab until the user reads it again; that pause lives in the service worker's memory and lapses if Chrome restarts it.

Focus sync follows page focus in the native tree too, with no debugger attach. While it is on, each native read (`NATIVE_READ` with `pageKeys`) numbers every document's elements twice, the top document's and each frame's: over CDP (`DOM.getDocument`, in the session that document is read through) and in the content script's own walk of its frame's live document, both with `src/native/page-keys.ts`, and gives a document's rows those numbers only if its two walks agree. The extension's frame ids and CDP's frame tokens can't be turned into one another, so a frame's document is matched to its frame one of two ways. A frame of its parent's origin marks the `<iframe>` holding it (see Frames with no URL of their own above), its parent's walk reports that element's number with the mark, and CDP's walk gives the same element the same number: the document under it is the one of the frame that answered with the mark, or nobody's. This is the only way a frame the tab lists at an `about:` URL is matched. Any other frame is matched by URL: to the frame whose content script numbered a document at the same URL to the same digest, and only when that frame is the only one showing that URL, answered or not. Of two such frames showing the same page, either could be showing a document read at it, so neither is numbered. Only frames the content script can run in are asked (`http:`, `https:`, `file:`, `about:`, and no error page), at most 32: the frames the read put in the tree first, then those with no URL of their own, which a URL can't say are in it. A frame in the tree gets as long as the top frame to answer; once the top frame has answered, the read's own walks are in and the frames are listed, any other gets a quarter of a second more, and one still busy by then goes unnumbered until a read it answers. A frame's rows carry its frame id (`pageFrame`), and its `Iframe` row the frame it shows (`embedsPageFrame`). The content script keeps each element's number by identity and reports page focus by it, the service worker adds the reporting frame, and the panel looks the numbers up among that frame's rows, so a row is found for the focused element whatever the page has done since the read; a listener on each shadow root focus has been in hears the moves inside it, which never reach the document. Focus on an element with no row above it in its frame selects the frame's `Iframe` row. After a page writes a frame's document over again, none of its elements were there to be numbered, and focus inside it selects the frame's `Iframe` row until the next read. A frame no content script runs in (a sandboxed frame without `allow-same-origin`, a `data:` or `blob:` frame) isn't numbered, so focus inside it isn't followed. The service worker re-asserts the Focus sync toggle to every frame that announces itself as the panel last set it for that tab, so **Focus OFF** holds through page updates.

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
