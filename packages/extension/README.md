# Semantic Navigator — Chrome Extension

Chrome extension that adds a Side Panel with an interactive DOM/accessibility tree view for any web page.

## Installation (development)

1. Clone the [Semantic Navigator](https://github.com/real-a11y/semantic-navigator) repo
2. Install dependencies and build:
   ```bash
   pnpm install
   pnpm build
   ```
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the `packages/extension/dist` directory
6. Navigate to any web page and click the Semantic Navigator icon in the toolbar

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

- **Content Script** — Injected into every page. Extracts the DOM/accessibility tree using `@real-a11y-dev/core`, dispatches actions on real DOM elements, and manages the highlight overlay.
- **Background Service Worker** — Routes messages between the Side Panel and content scripts. Manages the Side Panel lifecycle.
- **Side Panel** — Renders the tree UI. Receives serialized tree data from the content script and sends action commands back.

### Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current tab's DOM for tree extraction |
| `sidePanel` | Register and open the Side Panel UI |
| `scripting` | Inject the content script when needed |

No data leaves your browser. The extension does not make any network requests.

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
