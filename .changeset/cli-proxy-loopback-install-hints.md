---
"@real-a11y-dev/cli": patch
---

The CLI's hints name commands that work where it runs.

- **Install hints name the command for how the CLI was installed.** That covers "No browser is downloaded yet.", a `--chrome-path` that isn't there, and a broken Chrome binary:
  - `npx real-a11y install` in a project that installed it;
  - `real-a11y install` for a global install;
  - `npx -y @real-a11y-dev/cli@<its version> install` for a run through npx.

  The first always said `npx real-a11y install`, and the others `real-a11y install`. In a run through npx neither works: `npx real-a11y` asks the registry for an unscoped package that isn't ours, and `real-a11y` isn't on PATH. `npx real-a11y` misses a global install too, unless it sits in npm's own global prefix. "No browser is downloaded yet." also no longer suggests `npx playwright install chromium`, which downloads the browser revision of whichever Playwright npx fetches, not the one the CLI loaded.

- **Playwright missing, in a run through npx:** the hint now says to install the CLI and Playwright in the project. The global Playwright it suggested isn't visible to an npx run.
- **A proxy failure's hint** names `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` rather than a `--proxy` flag, which doesn't exist.
