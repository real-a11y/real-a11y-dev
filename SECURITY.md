# Security Policy

## Supported versions

Real A11y is pre-1.0. Only the latest `0.x` release is supported with fixes. Once 1.0 ships, this table will be updated to reflect an LTS policy.

| Version | Supported |
|---|---|
| Latest `0.x.y` | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

Please **do not file a public issue** for security problems. Instead, report privately via one of:

1. **Email:** `security@real-a11y.dev`
2. **GitHub private advisory:** <https://github.com/real-a11y/real-a11y-dev/security/advisories/new>

Include:
- A description of the issue and which package/component is affected
- Steps to reproduce (a minimal reproduction repo or script is ideal)
- Your assessment of impact (what an attacker could do)
- Any suggested fix, if you have one

## What to expect

| Step | Target timeline |
|---|---|
| Acknowledge receipt | Within 72 hours |
| Initial assessment & severity | Within 7 days |
| Fix or mitigation released | Within 30 days for critical/high, best-effort for medium/low |
| Public disclosure | After a fix is released, or 90 days from report, whichever is sooner |

For critical issues, we will coordinate a disclosure date with you before publishing.

## Scope

In scope:
- `@real-a11y-dev/core`, `@real-a11y-dev/inspector`, `@real-a11y-dev/react`, `@real-a11y-dev/testing`, `@real-a11y-dev/storybook-addon`, `@real-a11y-dev/semantic-navigator-ui`
- The Chrome extension in `packages/extension/`
- The website at `real-a11y.dev`

Out of scope:
- Third-party dependencies (please report upstream; we'll track and update)
- Social engineering, physical attacks, DoS against project infrastructure
- Findings from automated scanners without a working exploit

## Safe harbor

Good-faith security research conducted under this policy is considered authorized. We will not pursue legal action against researchers who:
- Make a good-faith effort to avoid privacy violations, data destruction, and service interruption
- Report the issue promptly and give us reasonable time to respond before public disclosure
- Don't access, modify, or retain data belonging to other users beyond what is necessary to demonstrate the issue

Thank you for helping keep Real A11y and its users safe.
