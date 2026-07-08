---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.
