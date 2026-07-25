---
"@real-a11y-dev/cli": patch
---

`audit` now honors each URL entry's `rootSelector` and `name` from `a11y.config.json`, matching what `snapshot` already did and what the config docs have always promised.

`resolveAuditTargets` collapsed every config page down to `{ url, name, fileApproved }`, discarding both fields — so a route configured with `"rootSelector": "main"` was audited at `body` anyway and reported findings from outside the region it was scoped to (a site-wide header link, say). Two consequences, both fixed:

- **`rootSelector` scopes the audit.** An explicit `--root` still wins, since it's a deliberate override for that run; omit it and each route uses its own selector. `--producer native` combined with a config `rootSelector` is now a hard error with the same wording as `--producer native --root`, rather than silently auditing the whole document.
- **The config `name` survives.** The page name is part of the `v1` finding fingerprint, so overwriting it with the redacted URL meant `audit` could never produce fingerprints matching `snapshot`'s (or the MCP's) for the very same config entry. A name that defaulted to the URL is still redacted, so userinfo and secret query params never reach a report.

If you run `audit` against a config whose entries carry an explicit `name`, its JSON output now reports that name instead of the URL — which is what makes the fingerprints line up across commands.
