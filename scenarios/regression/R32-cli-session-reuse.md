---
id: R32
suite: regression
scenario: "CLI `--session` reuse — act and view commands share one daemon page"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.2"
validUntil: ""
expected: "Each browser-driving command accepts `--session` and reuses a single daemon page; `tree` after `click` shows the state the click changed; `--session-idle-timeout` shortens the idle timer; `session list`/`stop` manage the daemon."
covers:
  - cli.commands.audit.flags.--session
  - cli.commands.audit.flags.--session-idle-timeout
  - cli.commands.click.flags.--session
  - cli.commands.click.flags.--session-idle-timeout
  - cli.commands.focus.flags.--session
  - cli.commands.focus.flags.--session-idle-timeout
  - cli.commands.inspect.flags.--session
  - cli.commands.inspect.flags.--session-idle-timeout
  - cli.commands.interact.flags.--session
  - cli.commands.interact.flags.--session-idle-timeout
  - cli.commands.list.flags.--session
  - cli.commands.list.flags.--session-idle-timeout
  - cli.commands.outline.flags.--session
  - cli.commands.outline.flags.--session-idle-timeout
  - cli.commands.snapshot.flags.--session
  - cli.commands.snapshot.flags.--session-idle-timeout
  - cli.commands.tabs.flags.--session
  - cli.commands.tabs.flags.--session-idle-timeout
  - cli.commands.tree.flags.--session
  - cli.commands.tree.flags.--session-idle-timeout
  - cli.commands.type.flags.--session
  - cli.commands.type.flags.--session-idle-timeout
---

## Steps

Build the CLI first — the regression suite drives the built `dist/index.js`.

```bash
pnpm --filter @real-a11y-dev/cli build
```

Create a fixture `fixture.html` with a button that toggles a status paragraph,
a text field labelled "Email", and a link to a second page:

```html
<!doctype html>
<html>
  <body>
    <main>
      <h1>Session reuse fixture</h1>
      <button onclick="
        const out = document.getElementById('status');
        out.textContent = out.textContent === 'off' ? 'on' : 'off';
      ">Toggle</button>
      <p id="status">off</p>
      <label>Email <input type="text" /></label>
      <a href="other.html">Go</a>
    </main>
  </body>
</html>
```

1. `real-a11y session stop-all`
2. `real-a11y tree <fixture> --session reuse-demo --allow-file`
3. `real-a11y click <fixture> --session reuse-demo --allow-file --role button --name "Toggle"`
4. `real-a11y tree <fixture> --session reuse-demo --allow-file`
5. `real-a11y type <fixture> --session reuse-demo --allow-file --role textbox --name "Email" --text hello`
6. `real-a11y focus <fixture> --session reuse-demo --allow-file --role textbox --name "Email"`
7. `real-a11y inspect <fixture> --session reuse-demo --allow-file`
8. `real-a11y outline <fixture> --session reuse-demo --allow-file`
9. `real-a11y list button <fixture> --session reuse-demo --allow-file`
10. `real-a11y tabs <fixture> --session reuse-demo --allow-file`
11. `real-a11y snapshot <fixture> --session reuse-demo --allow-file -o baseline.json`
12. `real-a11y audit <fixture> --session reuse-demo --allow-file --format json -o audit.json`
13. `real-a11y tree <fixture> --session reuse-demo --session-idle-timeout 30000 --allow-file`
14. `real-a11y session list`
15. `real-a11y session stop reuse-demo`
16. `real-a11y session list`

## Expected

- **1** — exits `0` even when no session was running; cleans any stale daemon.
- **2** — exits `0`; contains `paragraph "off"`.
- **3** — exits `0`; the diff names the change (`paragraph "off"` → `paragraph "on"`).
- **4** — exits `0`; contains `paragraph "on"` (the click from step 3 is still in effect).
- **5** — exits `0`; the command succeeds and the typed value is intentionally redacted from the diff (do not assert a visible value change).
- **6** — exits `0`; the diff shows focus moved to the textbox.
- **7** — exits `0`; produces findings + tree + outline from the same page (`inspect` takes only a URL, not `--role`/`--name`).
- **8** — exits `0`; prints `h1` in document order.
- **9** — exits `0`; lists only buttons from the same page.
- **10** — exits `0`; prints the tab order.
- **11** — exits `0`; writes a snapshot artifact.
- **12** — exits `0`; audits the same page and writes findings JSON (use `--format json` for JSON output).
- **13** — exits `0`; starts or reconfigures the daemon with a 30-second idle timeout (`--session-idle-timeout` is an integer number of milliseconds).
- **14** — before stop: lists one running session named `reuse-demo`.
- **15** — exits `0`; the named session is gone.
- **16** — exits `0`; the `reuse-demo` session no longer appears.

## Why this exists

The daemon only matters if the page outlives a single CLI process. Without reuse,
every `real-a11y click ... --session checkout` would behave like `--session` was
absent, and the whole feature would be a no-op. This row also pins that the
flag is accepted on every browser-driving command, not only `tree` and `click`.
