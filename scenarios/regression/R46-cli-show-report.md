---
id: R46
suite: regression
scenario: "CLI `show-report` — serves the snapshot report on loopback and redraws it as tests rerun"
area: CLI
type: Manual
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.14 (installed from the packed tarball, not a workspace link)"
validUntil: ""
expected: "show-report opens the recorded snapshots in the panel's tree with no console error; the page redraws without a reload when tests rerun, keeping the rows you opened on a record that didn't change; it listens on 127.0.0.1 only and refuses another Host; Ctrl+C exits 0"
covers:
  - cli.commands.show-report
notion: ""
---

## Steps

In a scratch project set up as in **R45** (Vitest 3+, the `testing` tarball, the
reporter in `reporters`), install the packed `cli` tarball too.

1. Before any test has run: `npx real-a11y show-report`
2. In a second terminal, run `npx vitest run`, and watch the page
3. In the page, collapse a row of the selected record. Then start `npx vitest`
   and edit a **different** test file so it reruns alone
4. Edit the selected record's test so its snapshot changes
5. `curl -i -H "Host: evil.example:9324" http://127.0.0.1:9324/__records`, then
   `curl -i http://127.0.0.1:9324/records/`
6. On Linux or macOS, `lsof -iTCP:9324 -sTCP:LISTEN -n -P`. On Windows,
   `netstat -ano | findstr :9324`
7. A second `npx real-a11y show-report --no-open` while the first still runs
8. <kbd>Ctrl</kbd>+<kbd>C</kbd> in the first terminal, then `echo $?`
9. `npx real-a11y show-report https://example.com`, then
   `npx real-a11y show-report missing-folder`, then
   `npx real-a11y show-report --port 99999`
10. With `CI=1`, `npx real-a11y show-report`

## Expected

- **1** — the browser opens on `http://127.0.0.1:9324/`, the URL is on stdout, and
  the page says no snapshots are recorded yet and how to add the reporter. No
  `a11y-snapshots` folder is created
- **2** — the snapshots appear without a reload, with no console error or CSP
  violation
- **3** — the other file's records update, and the row you collapsed stays
  collapsed
- **4** — the selected record shows its new tree and text
- **5** — `403` for the foreign `Host` and `404` for the path, neither with any
  record in the body
- **6** — one listener, on `127.0.0.1`, never `0.0.0.0` or `*`
- **7** — the second one prints another port's URL and serves the same records
- **8** — exit code `0`, and no `interrupted` error
- **9** — each exits `2`: the URL's message names `audit` and `snapshot`, the
  folder's says it doesn't exist, the port's gives the valid range
- **10** — the URL is printed, and no browser opens

## Why this exists

The records describe the app under test, and a server on a developer's machine
can be reached by any site open in their browser. Step 5 guards the two ways in:
a page rebinding its own domain to `127.0.0.1`, and a path that reads a file.
The other job that can quietly break is following a run: a test run deletes the
records folder it reads, which ends a file watcher, so step 2 has to see records
arrive after that has happened.
