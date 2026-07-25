---
"@real-a11y-dev/cli": minor
---

`audit` now honors each URL entry's `rootSelector`, and `audit` and `snapshot` derive a page's `name` identically — so the same configured route fingerprints the same way whichever command produced the artifact.

**`rootSelector` scopes the audit.** `resolveAuditTargets` collapsed every config page down to `{ url, name, fileApproved }`, discarding both `rootSelector` and `name`. A route configured with `"rootSelector": "main"` was audited at `body` anyway and reported findings from outside the region it was scoped to — a site-wide header link, say. An explicit `--root` still wins, since it's a deliberate override for that run; omit it and each route uses its own selector. `--producer native` combined with a config `rootSelector` is now a hard error with the same wording as `--producer native --root`, rather than silently auditing the whole document.

**One page name, settled once.** The name is the `v1` fingerprint's page component and `diff`'s join key, but the two commands derived it differently: `audit` re-derived it with `redactUrl`, while `snapshot` used the config value raw. A bare entry like `"http://localhost:3000"` therefore became `http://localhost:3000/` under `audit` and `http://localhost:3000` under `snapshot` — divergent fingerprints for one route. `resolvePageList` now settles the name once, at the single point both commands read their pages from.

**Breaking:** for `urls` entries written as bare URL strings, the page `name` in a snapshot artifact is now the canonical URL (`http://localhost:3000/`, trailing slash) instead of the string as written. Since `name` feeds every finding fingerprint and `diff` joins on it, a baseline or committed artifact produced by an older version won't match one produced by this release for those routes — re-record it with `--update-baseline`. Entries with an explicit `name` are unaffected.

**Security:** a name that defaulted to the URL is now redacted the same way the `url` field always was. Previously a positional or bare-string target carrying userinfo or a `?token=` wrote those credentials into the artifact's `name` field and the baseline, beside a carefully redacted `url`.
