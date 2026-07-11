---
title: "Auditing authenticated pages"
description: Audit pages behind a login with the Real A11y CLI and MCP — reuse a saved session or attach to your logged-in browser, without ever handing a tool your password.
---

# Auditing authenticated pages

Most real accessibility problems live *behind* a login — the dashboard, the
settings screen, the checkout. Both the [CLI](/packages/cli) and the
[MCP server](/packages/mcp) can audit those pages, and the guiding rule is the
same for both: **you log in; the tool reuses the session.** Your password is
never typed by an agent, never passed as a flag, never stored in shell history.

There are two ways in. Reach for the first by default.

| Aspect | **Saved session** (`--storage-state`) | **Attach to your browser** (`--cdp`) |
| --- | --- | --- |
| How | Log in once, save a session file, reuse it | Point the tool at a Chrome you're already logged into |
| Best for | Repeatable audits, CI, "the logged-in dashboard" | One-off / interactive, SSO or MFA too painful to script |
| Reproducible? | Yes — commit the workflow, not the file | No — depends on your live browser |
| Device emulation | Works | Not available (reuses the running browser) |
| Password to the tool? | No | No |

## Saved session (recommended)

### 1. Save the session

Run `login` once. It opens a **visible** browser — log in by hand, and MFA,
SSO, and passkeys all work, because a person is driving. Then press **Enter** in
the terminal to save.

```sh
real-a11y login https://app.example.com --save auth.json
```

```
Log in in the browser window, then press Enter here to save.
saved session state to /path/to/auth.json
audit a page on https://app.example.com with it:
  real-a11y audit <url> --storage-state auth.json
```

::: tip Accept cookie banners before pressing Enter
If the site shows a cookie-consent dialog, accept or dismiss it in the login
window before saving — otherwise the consent cookie isn't in your session and the
banner reappears (and can dominate the audited tree) on every later run.
:::

### 2. Audit with it

Pass the file to any browser command:

```sh
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
real-a11y tree  https://app.example.com/settings  --storage-state auth.json
```

::: tip Give single-page apps time to hydrate
A logged-in SPA reads the session, calls its API, and renders — all after the
initial load. If you capture a half-rendered or redirected view, settle it:
`--wait-until networkidle --settle 3000`.
:::

### Origin pinning

When a session is loaded, auditing is **pinned to the origin you asked for**. If
a page redirects off that origin, extraction is refused (exit `2`) rather than
silently auditing wherever it landed:

```
real-a11y: error: Refusing to audit https://elsewhere.example: not an allowed
audit origin under an authenticated session (a redirect may have left the
intended site).
  hint: the page redirected off the audited origin; pass --audit-origin <origin>
  if that's expected.
```

This is a safeguard: a saved session carries live cookies, and a stray or
hostile redirect to another cookie-matching origin could otherwise pull an
unintended authenticated page into your report. If the redirect is legitimate —
an SSO bounce that ends on a second origin — allow it explicitly:

```sh
real-a11y audit https://app.example.com/dashboard \
  --storage-state auth.json --audit-origin https://auth.example.com
```

Refusal is also a useful signal: it usually means the **session expired** and
the site bounced you to a login page. Re-run `login` to refresh `auth.json`.

## Attach to your logged-in browser (`--cdp`)

For a one-off — or an app whose auth lives in `sessionStorage`, which a saved
session can't capture — skip the file and attach to a Chrome you're already
signed into. Start Chrome with remote debugging **on a throwaway profile**, log
in, then point the tool at it:

```sh
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-cdp
real-a11y audit https://app.example.com/dashboard --cdp http://localhost:9222
```

::: danger Use a dedicated profile for CDP
Attaching over CDP connects to whatever Chrome is on that port — **including
your everyday browser and its logged-in sessions** (email, banking). Always
launch a separate profile with its own **--user-data-dir**, never enable remote
debugging on your main profile.
:::

The MCP server uses the same mechanism via the `REAL_A11Y_MCP_CDP` environment
variable — see the [MCP configuration](/packages/mcp#configuration).

## Security

The saved session file is a **credential** — treat `auth.json` like a password:

- **Never commit it.** It holds live session tokens. `login` writes it with
  owner-only permissions and warns if it lands un-gitignored inside a repo — add
  it to `.gitignore`.
- **Use a dedicated low-privilege test account**, not your admin or personal
  account. Anyone (or any agent) with the file can read every page that session
  can reach.
- **It's short-lived** — it stops working when the site's session expires. `login`
  is the re-auth path.
- **`sessionStorage` is not captured.** Apps that keep auth there will land
  logged-out after a saved-session restore — use `--cdp` for those.

### In CI

Provision the file from a secret at job start; hosted runners are ephemeral, so
no cleanup step is needed:

```yaml
- run: printf '%s' "$A11Y_STORAGE_STATE" > auth.json
  env:
    A11Y_STORAGE_STATE: ${{ secrets.A11Y_STORAGE_STATE }}
- run: npx real-a11y audit https://staging.example.com/dashboard --storage-state auth.json
```

Rotate by re-running `login` locally and updating the secret.

::: danger Never run untrusted config with a live session
Do not audit a pull-request-controlled URL or config while a secret-provisioned
session is loaded (e.g. under a **pull_request_target** trigger). A PR could
point the audit at an attacker page that redirects into your authenticated site. Keep the audit
target a literal in the workflow — origin pinning then fails closed on any
redirect elsewhere.
:::

## See also

- [`@real-a11y-dev/cli`](/packages/cli) — the full command reference.
- [`@real-a11y-dev/mcp`](/packages/mcp) — the same audit for AI agents.
