---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

`--version` and browser commands now resolve Playwright the same way (`createRequire`, which sees `NODE_PATH` and a sibling global). `npm i -g playwright` unblocks a global CLI; `--version` no longer prints a version while `audit` cannot load the driver. The missing-Playwright hint names `npm i -g playwright` when the CLI is not in the current project's `node_modules`.
