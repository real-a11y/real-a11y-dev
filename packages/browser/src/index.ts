/**
 * @real-a11y-dev/browser — drive a real browser for Real A11y.
 *
 * `BrowserSession` navigates a live Chromium with Playwright, injects the
 * pre-built page-bundle (which sets `window.__realA11y__`), and routes every
 * accessibility query through `page.evaluate()`. A real browser is required —
 * the extraction engine relies on `getComputedStyle`/layout to decide what is
 * exposed to assistive tech, which a server-side jsdom cannot reproduce.
 *
 * This is the single way the CLI and the MCP server drive a real browser.
 */

export * from "./browser.js";
export { nativeTree, buildNativeTree } from "./native-tree.js";
