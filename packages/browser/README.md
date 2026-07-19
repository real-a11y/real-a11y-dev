# @real-a11y-dev/browser

Drive a real browser for Real A11y. This package is the **one way** the toolkit extracts an accessibility tree from a live Chromium — a Playwright-based `BrowserSession` plus the pre-built page-bundle it injects. The CLI and the MCP server both drive the browser through it.

```sh
npm install @real-a11y-dev/browser
# a real browser is required:
npm install playwright   # optional peer
```

Why a real browser and not jsdom? The extraction engine relies on `getComputedStyle` and layout to decide what is actually exposed to assistive tech — visibility, focusability, computed roles. A server-side jsdom can't reproduce that faithfully, so an audit that matters needs a real Chromium.

## `BrowserSession`

```ts
import { BrowserSession } from "@real-a11y-dev/browser";

const session = new BrowserSession({ headless: true });
await session.open("https://example.com");

const snapshot = await session.snapshot();
// { findings, tree, outline, tabOrder }

await session.close();
```

`BrowserSession` launches Chromium with Playwright, injects the page-bundle (which sets `window.__realA11y__`), and routes every query through `page.evaluate()`. `playwright` is an **optional peer dependency**, imported lazily — importing this package never forces playwright to load, so browser-free code paths stay light.

## The page-bundle

The injected bundle is built here (`dist/page-bundle.iife.global.js`) from the serializers (`@real-a11y-dev/serialize`), the findings engine (`@real-a11y-dev/audit`), and the query helpers (`@real-a11y-dev/core`). It's an IIFE that installs `window.__realA11y__` with the snapshot/assertion helpers so any caller can invoke them by name inside the page.

Because the bundle ships in this package, both drivers resolve the exact same file:

- `BrowserSession` reads it from its own `dist/`.
- The `@real-a11y-dev/testing/playwright` adapter imports the exported `PAGE_BUNDLE_PATH` and injects the same bundle.

One bundle, one home — so a tree captured through the CLI, the MCP server, or the Playwright adapter is identical.

## Design

This package is **the only place that touches Playwright**. Everything above it in the stack is a pure, browserless engine (`core` extraction, `serialize` text, `audit` findings, `snapshot` diffs); everything that needs a live page — the CLI, the MCP server, the testing Playwright adapter — composes `browser`. Isolating the real-browser concern here means a consumer that only needs the engine never pulls Playwright into its dependency graph.
