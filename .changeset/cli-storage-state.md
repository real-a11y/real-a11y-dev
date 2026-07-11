---
"@real-a11y-dev/cli": minor
---

Audit pages behind a login, without ever handing the tool a password. `real-a11y login <url> --save auth.json` opens a visible browser, you log in by hand (MFA/SSO/passkeys all work), press Enter, and the session is saved; `--storage-state auth.json` on `audit`/`inspect`/`tree`/`outline`/`tabs`/`list` then audits as that logged-in user. The saved file is written `0o600` and the command warns if it lands un-gitignored inside a repo.

Under a loaded session, auditing is **origin-pinned**: extraction is refused if a page redirects off the target's origin (exit 2), so a stray or hostile redirect can't pull an unintended authenticated page into a report — `--audit-origin <origin>` allows a known SSO bounce. Storage-state files are validated up front with catalog-style errors that never echo their contents, `--storage-state` conflicts with `--cdp`, and an expired session surfaces an advisory "may have expired — re-run login" note. `login` is interactive-only (exits 2 with a clear hint in CI). Session storage isn't captured by storage state — `--cdp` remains the interactive fallback for apps that keep auth there.
