---
name: cli-session-daemon
description: Test the real-a11y CLI session daemon lifecycle and --session reuse.
---

> **Do not follow this skill on `main`.** The `session`, `--session`, and `--session-idle-timeout` surface it documents is part of the `feat/session-daemon-lifecycle` feature branch and is not yet merged to `main`. Use this skill only when working on that feature branch; merge this skill PR after the feature branch lands on `main`.

# Testing the real-a11y CLI session daemon

This skill covers end-to-end verification of the `real-a11y` session daemon lifecycle on the `feat/session-daemon-lifecycle` branch.

## Devin Secrets Needed

- None

## One-time setup

- Node 20+ and pnpm 9.15.0 should already be available from the repo blueprint.
- `pnpm install --frozen-lockfile` is run as part of maintenance.
- Playwright's Chromium bundle is used for headless browser launches; no separate `real-a11y install` is required if Playwright's Chromium is cached at `~/.cache/ms-playwright`.
- `xterm` can be installed (`sudo apt-get install -y xterm`) if a terminal UI/screenshots are needed, but it is not required for the tests themselves.

## Build the CLI

Run from the repo root:

```bash
pnpm --filter @real-a11y-dev/cli build
```

The built entry is `packages/cli/dist/index.js`.

## Manual end-to-end test flow

Create a fixture file:

```bash
cat > /tmp/test-fixture.html <<'EOF'
<!doctype html>
<html>
  <body>
    <main>
      <h1>Session daemon fixture</h1>
      <button onclick="
        const out = document.getElementById('status');
        out.textContent = out.textContent === 'off' ? 'on' : 'off';
      ">Toggle</button>
      <p id="status">off</p>
    </main>
  </body>
</html>
EOF
```

Then, from `packages/cli`:

```bash
BIN=dist/index.js
FIX=file:///tmp/test-fixture.html

# start a session and read the tree
node "$BIN" tree --session lifecycle --allow-file "$FIX" --quiet

# click toggles the paragraph to "on" in the same daemon session
node "$BIN" click --session lifecycle --allow-file "$FIX" --role button --name Toggle --quiet

# second tree shows the persisted page state
node "$BIN" tree --session lifecycle --allow-file "$FIX" --quiet

# inspect/list/stop sessions
node "$BIN" session list
node "$BIN" session list --format json
node "$BIN" session stop lifecycle
node "$BIN" session stop-all
```

## `--session-idle-timeout` caveats

- `--session-idle-timeout=5000000` is capped to `3600000` (1 hour). Verify via `/proc/<pid>/cmdline`.
- `--session-idle-timeout=-1` is rejected with `--session-idle-timeout must be a non-negative number`.
- To test the timer, use `--session-idle-timeout=2000`, wait longer than 2 seconds, then run `session list --format json` again. The daemon process should exit and the session should be reported as `stale`.

## E2E suite

From `packages/cli`:

```bash
pnpm test:e2e
```

This runs `vitest.e2e.config.ts` against the built CLI and real headless Chromium. All suite files run, including `e2e/session-daemon.e2e.test.ts`.

## Cleanup

After testing, run:

```bash
node "$BIN" session stop-all --quiet
rm -rf ~/.real-a11y/sessions
```

## Typical issues

- If `node "$BIN"` cannot find `playwright`, make sure `pnpm install --frozen-lockfile` completed and you are inside the workspace package directory.
- If the browser fails to launch with a shared-library error, run `npx playwright install-deps chromium` (requires apt privileges).
- If `tree`/`snapshot` with `file://` URLs fails, include `--allow-file`.
