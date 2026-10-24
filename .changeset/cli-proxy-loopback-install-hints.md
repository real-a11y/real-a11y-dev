---
"@real-a11y-dev/cli": patch
---

Behind a proxy, a `NO_PROXY` that names loopback now keeps it off the proxy on every Playwright the CLI accepts, and the CLI's hints name commands that work where it runs.

- **Proxy.** On Playwright 1.49 to 1.58.2, localhost, 127.0.0.1 and the other loopback hosts went through `HTTPS_PROXY` even when `NO_PROXY` named them. So an audit of a local server failed with `net::ERR_PROXY_CONNECTION_FAILED` behind a dead proxy, and behind a live one, audited the proxy's error page as the page. A `NO_PROXY` that names a loopback host, or is `*`, now bypasses loopback on those versions as it does from Playwright 1.59. A `NO_PROXY` naming no loopback host is passed on as before, and loopback still goes through the proxy then, as Playwright has always done.
- **"No browser is downloaded yet."** now names the install command for how the CLI was installed:
  - `npx real-a11y install` in a project that installed it;
  - `real-a11y install` for a global install;
  - `npx -y @real-a11y-dev/cli install` for a run through npx.

  It always said `npx real-a11y install`. Outside such a project, that asks the registry for an unscoped package that isn't ours. The hint also no longer suggests `npx playwright install chromium`, which downloads the browser revision of whichever Playwright npx fetches, not the one the CLI loaded.

- **Playwright missing, in a run through npx:** the hint now says to install the CLI and Playwright in the project. The global Playwright it suggested isn't visible to an npx run.
- **A proxy failure's hint** names `HTTPS_PROXY` and `NO_PROXY` rather than a `--proxy` flag, which doesn't exist.
