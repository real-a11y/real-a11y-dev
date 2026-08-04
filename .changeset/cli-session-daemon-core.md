---
"@real-a11y-dev/cli": minor
---

Session daemon core: a long-lived `real-a11y` process that keeps a browser page warm across CLI invocations.

The daemon (`packages/cli/src/daemon/entry.ts` → `dist/daemon/entry.js`) listens on a Unix domain socket and speaks NDJSON RPC. It holds a `SessionRegistry` of named `BrowserSession` instances, serialises commands per session, supports an idle timeout, and writes a pidfile on startup.

Initial daemon-side command runners are wired for the view and interaction commands: `tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, and `focus`. Each runner compares the session's current URL and skips navigation when already on the target page, so successive requests against the same session reuse the live page. `audit` and `snapshot` daemon runners follow in a later PR.
