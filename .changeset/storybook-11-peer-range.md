---
"@real-a11y-dev/storybook-addon": minor
---

Add Storybook 11 to the peer range, as `storybook: ^9.0.0 || ^10.0.0 || ^11.0.0-0`.

The `-0` is load-bearing rather than cosmetic. Storybook 11 is still prerelease — `11.0.0-alpha.0` is the only 11.x published — and npm ranges exclude prereleases unless the range itself names one, so a plain `^11.0.0` would have matched no Storybook 11 that currently exists. Consumers on 11 would have kept getting a peer error from a range that claimed to support them.

Nothing in the addon's code changed: it registers `types.PANEL` and imports `storybook/manager-api` / `storybook/preview-api`, all of which 11 still serves. The range was previously held back partly because the `TAB` addon type Storybook's release notes describe as removed is still present in the enum — that is accurate, but it does not apply to this addon, which never used `TAB`.

Support for 11 is verified by type-checking and building against `11.0.0-alpha.0` — `tsc` resolves Storybook 11's own `manager-api`/`preview-api` declarations and checks the addon's usage against them. The package's unit tests mock `storybook/preview-api`, so they pass under 11 without exercising it and are deliberately not cited as evidence. Re-checked by a new advisory CI job that installs `storybook@next`, so a breaking change in 11 shows up as a CI signal rather than in a consumer's install. It remains provisional while 11 is in alpha: verified, not guaranteed.
