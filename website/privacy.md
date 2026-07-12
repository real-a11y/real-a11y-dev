# Privacy Policy

_Last updated: 2026-04-18_

This policy covers the Real A11y website (`real-a11y.dev`), the Semantic Navigator Chrome extension, and the `@real-a11y-dev/*` npm packages.

## Short version

- We don't collect personal data.
- The Chrome extension runs entirely on your device. It does not send page content, URLs, or any other data to any server — ours or anyone else's.
- The npm library packages run on your device / in your CI and make no network requests. The CLI and MCP server load only the page you point them at — that request goes to your target URL, never to us.
- The website may use privacy-respecting aggregate analytics (no cookies, no personal identifiers). If enabled, it's disclosed here.

## Chrome extension — Semantic Navigator

The extension reads the DOM of the page you're currently viewing in order to build and display a semantic / accessibility tree in a side panel. It acts locally in your browser.

**What it does on the page:**

- Reads the page's DOM (including iframes you can access) to extract roles, accessible names, states, and interaction info.
- On your explicit action (clicking a tree node's action button, pressing `Enter`, etc.), dispatches the corresponding event on the element — e.g. click a button, focus a field, submit a form.
- Draws a highlight overlay on the element under the cursor in the tree.

**What it does NOT do:**

- It does not send page content, URLs, DOM snapshots, or any other data to any external server.
- It does not read from or write to the clipboard.
- It does not use cookies, local storage, or IndexedDB for any personal data.
- It does not track you across sites or sessions.
- It contains no analytics, telemetry, advertising, or third-party scripts.

**Permissions and why they're needed:**

| Permission | Why |
|------------|-----|
| `activeTab` | Read the DOM of the page you're viewing to build the tree |
| `sidePanel` | The extension's UI is a persistent side panel |
| `webNavigation` | Detect iframe load events to merge subtree data from cross-origin frames |

No other permissions are requested.

## npm packages

The `@real-a11y-dev/core`, `@real-a11y-dev/inspector`, `@real-a11y-dev/testing`, `@real-a11y-dev/react`, `@real-a11y-dev/storybook-addon`, and `@real-a11y-dev/semantic-navigator-ui` packages are pure libraries. They:

- Run where you run them (browser, Node, jsdom, Playwright).
- Make no network requests.
- Do not "phone home," collect usage data, or check for updates.
- Have no side effects at install time beyond what `pnpm` / `npm` / `yarn` does normally.

`@real-a11y-dev/cli` and `@real-a11y-dev/mcp` build on those libraries but additionally drive a headless browser (Playwright) so they can audit a live page. That browser loads **only the URL you give them** — the page you asked to audit — and reads its accessibility tree locally. They send no page content, no results, and no telemetry to us or any third party. Installing the browser with `npx playwright install` downloads it from Microsoft's Playwright CDN, the same as any Playwright project — that is the only network activity, and it is under your control.

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
