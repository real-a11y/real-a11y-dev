# Privacy Policy

_Last updated: 2026-10-01_

This policy covers the Real A11y website (`real-a11y.dev`), the Semantic Navigator Chrome extension, and the `@real-a11y-dev/*` npm packages.

## Short version

- We don't collect personal data.
- The Chrome extension runs entirely on your device. It does not send page content, URLs, or any other data to any server — ours or anyone else's.
- The npm library packages run on your device / in your CI and make no network requests. The CLI and MCP server load only the page you point them at — that request goes to your target URL, never to us.
- The CLI and MCP server print what a page's form fields hold (never a password, one-time code or card field); a strict mode leaves every field value out. [Details](#field-values-in-what-they-print).
- The website may use privacy-respecting aggregate analytics (no cookies, no personal identifiers). If enabled, it's disclosed here.

## Chrome extension — Semantic Navigator

By default, the extension reads the DOM of the page you're currently viewing in order to build and display a semantic / accessibility tree in a side panel ("DOM mode"). It acts locally in your browser.

It also offers an opt-in **native mode**, off by default: reading Chromium's own accessibility tree over the `chrome.debugger` API (the same protocol DevTools uses), for fidelity DOM mode can't reach (UA-shadow content like media controls). Turning it on requires an explicit, one-time step in the side panel that names what it does before it activates; while attached, Chrome itself shows its own "…is debugging this browser" notice, independent of anything this extension displays. Turning the setting back off immediately detaches.

**What it does on the page:**

- Reads the page's DOM (including iframes you can access) to extract roles, accessible names, states, and interaction info.
- If you've turned on native mode, reads Chromium's accessibility tree for the active tab over `chrome.debugger` instead, while it's attached.
- On your explicit action (clicking a tree node's action button, pressing `Enter`, etc.), dispatches the corresponding event on the element — e.g. click a button, focus a field, submit a form.
- Draws a highlight overlay on the element under the cursor in the tree.

**What it does NOT do:**

- It does not send page content, URLs, DOM snapshots, accessibility-tree data, or any other data to any external server — everything above stays local to your browser, in both DOM and native mode.
- It does not read from or write to the clipboard.
- It does not use cookies, local storage, or IndexedDB for any personal data — `chrome.storage.local` is used only to remember whether native mode is on and (while it's actively attached) short-lived, content-free bookkeeping about that attachment.
- It does not track you across sites or sessions.
- It contains no analytics, telemetry, advertising, or third-party scripts.

**Permissions and why they're needed:**

| Permission  | Why                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab` | Read the DOM of the page you're viewing to build the tree                                                                                                          |
| `sidePanel` | The extension's UI is a persistent side panel                                                                                                                       |
| `webNavigation` | Detect iframe load events to merge subtree data from cross-origin frames                                                                                        |
| `debugger`  | Powers native mode: reads and acts on Chromium's own accessibility tree over CDP. Requested by every install because `chrome.debugger` cannot be an optional Chrome permission, but native mode itself is off until you explicitly enable it in the side panel. |
| `tabs`      | Resolves which tab's accessibility tree to attach to when native mode is on. This is a broader grant than that use needs — Chrome does not let an extension request `tabs` scoped to a single tab, and it technically permits reading the URL/title of every open tab, not only the one native mode is attached to. The code only ever reads the tab id the side panel already gave it; it never enumerates other tabs. |
| `storage`   | Persists the native-mode on/off setting, and short-lived attach bookkeeping while it's on, locally on your device                                                  |

## npm packages

The `@real-a11y-dev/inspector`, `@real-a11y-dev/testing`, `@real-a11y-dev/react`, and `@real-a11y-dev/storybook-addon` packages are pure libraries — as is the extraction engine bundled inside each of them. They:

- Run where you run them (browser, Node, jsdom, Playwright).
- Make no network requests.
- Do not "phone home," collect usage data, or check for updates.
- Have no side effects at install time beyond what `pnpm` / `npm` / `yarn` does normally.

`@real-a11y-dev/cli` and `@real-a11y-dev/mcp` build on those libraries but additionally drive a headless browser (Playwright) so they can audit a live page. That browser loads **only the URL you give them** — the page you asked to audit — and reads its accessibility tree locally. They send no page content, no results, and no telemetry to us or any third party. Installing the browser with `npx playwright install` downloads it from Microsoft's Playwright CDN, the same as any Playwright project — that is the only network activity, and it is under your control.

### Field values in what they print

What these tools print is page content, and that includes what is **in the page's form fields**. Their live output — the CLI's `tree`, `tabs`, `list`, `inspect` and `interact` diff, the MCP server's tree, list, tab-order and diff tools — shows each field's value the way a screen reader announces it: the text in an email box, a chosen option, a draft in a rich-text editor. Wherever that output goes — your terminal, a CI log, or, for the MCP server, the AI agent you connected it to and that agent's model provider — those values go with it. Nothing is sent anywhere by the tools themselves.

What they never print is a field the page marks as secret: a `type="password"` field, or one whose `autocomplete` names a credential or a payment card (`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`). Those read `[redacted]` — not the text, not its length. And the text you hand to a `type` command or the `type_text` tool is never echoed back.

Outputs meant to be committed or shared — CLI `snapshot` artifacts and the diffs built from them, the MCP server's exported checkpoints — leave field values out unless you ask for them (`--values`, or `values: true`). That covers each field's own value; text the browser builds into an element's *name* from what a field or rich-text editor holds (a heading typed into an editor, a button around a filled box) is part of the page's names and stays, except for sensitive fields. The strict mode below withholds that too.

To keep every field value and all rich-text editor content out of the output, use the strict mode: `--redact-input` (or `defaults.redactInput` in `a11y.config.json`) for the CLI, `REAL_A11Y_REDACT_INPUT=1` for the MCP server, `attach(page, { tree: "native", redactInput: true })` in `@real-a11y-dev/testing`. Use it when a page's ordinary fields may hold something sensitive the markup doesn't say is sensitive. One view is built differently: the keyboard tab order (the CLI's `tabs`, the MCP server's `get_tab_order`) prints no values under the strict mode. A link or button typed into a rich-text editor is not a Tab stop, so it never appears there; a `contenteditable="false"` island such as a mention chip is one, and keeps its name.

## Website

The site at `real-a11y.dev` is a static VitePress documentation site. The only first-party state is the search index and local preferences (theme selection) stored in your browser's `localStorage`.

If we enable analytics in the future, we will:

1. Use a privacy-respecting, cookie-free provider (e.g. Plausible, Fathom, or Cloudflare Web Analytics).
2. Update this page to name the provider and what data is collected before enabling.
3. Never use Google Analytics or any product that requires a cookie banner in the EU.

## Data we might receive anyway

If you open an issue, comment, or send email:

- GitHub issues / discussions / PRs — subject to [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Anything you post there is public.
- Security reports to `security@real-a11y.dev` or the private GitHub security advisory — handled per [SECURITY.md](https://github.com/real-a11y/real-a11y-dev/blob/main/SECURITY.md); the email address and content are retained only as long as needed to investigate and fix the reported issue.
- Code of Conduct reports to `conduct@real-a11y.dev` — handled confidentially per [CODE_OF_CONDUCT.md](https://github.com/real-a11y/real-a11y-dev/blob/main/CODE_OF_CONDUCT.md).

## Your rights

If you have questions about this policy or want us to delete any data you've shared with us directly, email `privacy@real-a11y.dev`. We'll respond within 30 days.

## Changes to this policy

Changes are tracked in the git history of `website/privacy.md`. Material changes will bump the "Last updated" date at the top of the page.

## Contact

- Maintainer: Juan Crisostomo (Real A11y)
- Email: `privacy@real-a11y.dev`
- GitHub: [github.com/real-a11y/real-a11y-dev](https://github.com/real-a11y/real-a11y-dev)
