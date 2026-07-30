---
id: R27
suite: regression
scenario: "CLI `login` — a hand-captured session is reusable, private on disk, and never asks for credentials"
area: CLI
type: Manual
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Manual by construction — a human authenticates in a headful browser, which is the whole design"
validUntil: ""
expected: "login → audit --storage-state reaches authenticated content; the file is written 0o600 and warns when it lands un-gitignored inside a repo; `login` exposes NO credential flag and refuses --cdp; session-storage auth is documented as out of scope rather than silently half-captured"
covers:
  - cli.commands.login
notion: ""
---

## Steps

Needs a real authenticated app — a staging deploy or any account you control. A
fixture with a fake form does not exercise the thing this row is about, which is a
browser profile surviving as a file.

```bash
real-a11y login https://app.example.com --save auth.json
```

1. Run it. Confirm a **headful** browser opens and waits for you
2. Log in by hand, then let the command finish
3. `real-a11y audit https://app.example.com/dashboard --storage-state auth.json` —
   a page only reachable when signed in
4. Inspect the tree from that run: does it show the authenticated page, or the
   login screen?
5. Check the file mode: `stat -c %a auth.json` (POSIX) → `600`
6. Re-run `login --save` into a path **inside a git repo that doesn't gitignore
   it**, and read stderr
7. `real-a11y login <url> --save auth.json --cdp http://localhost:9222` — a flag
   `login` does not declare
8. `real-a11y login <url>` with no `--save`
9. `real-a11y login --help` — read the flag list against the docs
10. Try it on an app that keeps auth in **session storage** rather than cookies
11. `real-a11y audit <url> --storage-state ./nope.json`
12. Let a captured session **expire**, then re-run step 3

## Expected

- **1** — headful, always. A headless login cannot work, so a run that quietly went
  headless would hang forever with nothing to type into
- **3/4** — the audit reads the **authenticated** page. Silently auditing the login
  screen instead is the failure that matters here: it exits `0` on a page full of
  content nobody checked, and looks like a pass
- **5** — `0o600`. A session file is a live credential; world-readable is a real
  defect and an invisible one
- **6** — a warning on **stderr** naming the path. Committing a session file is the
  worst available outcome and the easiest mistake to make
- **7** — refused, because `login` declares no attach or credential options at all.
  Today that refusal is the strict parser's generic **unknown option**, which R7
  calls the second-worst answer: correct, but it doesn't tell you what to do
  instead. The invariant being pinned is that the flag is **not accepted**; a named
  refusal like the one `--root` gets in `run.ts` would be the better behaviour, and
  a run that reaches a browser here is the real failure
- **8** — exit `2`; `--save` is required and the message says so
- **9** — **no credential flag exists.** No `--username`, no `--password`, no
  `--token`. The password is typed into the real browser by a human and never
  touches our process, our argv, or the shell history. Same invariant `type_text`
  states in its own description (**R25** step 9) — this is the surface that makes it
  keepable
- **10** — the documented limitation holds: session-storage auth is **not** captured,
  and the docs say to use `--cdp`. A half-captured session that appears to work and
  then doesn't is worse than a refusal
- **11** — a clear error naming the missing file, not an unauthenticated audit
- **12** — an expired session must be visibly an auth problem, not reported as the
  page having lost all its content

## Why this exists

Migrated with no scenario at all in either suite — the coverage check found it on its
first full run, which is the argument for the check.

It is the only command that writes a **secret to disk**, and its two dangerous
failures are both silent:

- **Auditing the wrong page** (3/4). If the session doesn't apply, the tool audits
  the login screen and reports on it cheerfully. Every subsequent number is about a
  page nobody meant to test.
- **Leaking the file** (5/6). A `0644` write, or a session file committed to a repo,
  causes no error at all — at any point — and hands over a live account.

Step 9 is the design invariant worth pinning: the CLI deliberately has no way to
_accept_ a credential. Auth happens in a browser a human is looking at. Any future
flag that takes a password directly would contradict `type_text`'s own documented
promise, and this is the row that would catch it.

## Notes

**Type is Manual and stays Manual.** Steps 1–4 need a human to authenticate; that is
not an automation gap to be closed later, it is the point of the command. Steps
5–9 and 11 are mechanically checkable and worth scripting around a pre-captured
`auth.json` if this row ever gets partly automated.

**No dogfood twin yet.** The natural counterpart is capturing a session against a
real deployed app post-publish, from the registry build. Worth adding when there's an
authenticated surface on our own site to point it at — inventing one against a
third-party login would violate D10's own rule about not driving other people's
pages.
