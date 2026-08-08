---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

`real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

```sh
real-a11y install                           # latest Stable
real-a11y install --channel beta            # track a channel
real-a11y install --version 131.0.6778.87   # pin an exact build
```

This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

`BrowserSessionOptions` — re-exported by `@real-a11y-dev/mcp` — gains `executablePath`, so a caller driving the session directly can point it at a specific binary. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.
