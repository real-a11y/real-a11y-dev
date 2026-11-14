---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

Re-bundles the updated extractor, which gained a strict mode (`redactInput`) that the CLI, the MCP server and `@real-a11y-dev/testing` use to keep field values and rich-text editor content out of what they print. The panel never turns it on, so nothing it shows changes.
