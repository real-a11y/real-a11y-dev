---
"@real-a11y-dev/cli": patch
---

`--cdp` now says which `a11y.config.json` defaults it ignored, instead of dropping them silently, and an empty `--cdp ""` is an error rather than a fresh local browser.

**The warning.** An explicit `--cdp` keeps the config's `device`, `viewport`, `headful` and `storageState` out of the run, because a CDP connection reuses the attached browser's own window and session. That is unchanged. It used to happen without a word. Against a browser that isn't signed in, such as a fresh remote one, a config that says "logged in, on a phone" audited the logged-out desktop page and exited 0. The run now prints one warning on stderr naming each dropped key, even under `--quiet`, plus a second line when `storageState` is among them:

```
real-a11y: warning: --cdp ignores `device` and `storageState` from a11y.config.json — it uses the attached browser's own window and session.
  a browser that isn't signed in (a fresh remote one, say) audits the logged-out page.
```

The exit code and stdout are unchanged, so a CI check that relied on the dropped session stays green. The warning only puts the reason in the log. A `false` boolean (`"headful": false`) isn't reported, since dropping it changes nothing. No warning prints when the run is refused anyway, for example `--cdp` with `--headful`.

**Empty `--cdp`.** `--cdp ""`, which is what an unset CI variable such as `--cdp "$BROWSER_WS"` gives you, still dropped those defaults, but the session then read the empty value as no `--cdp` and launched a fresh local browser: a logged-out desktop audit at exit 0. It now fails with exit 2: `--cdp needs an endpoint, and got an empty value.`
