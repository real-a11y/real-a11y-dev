---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/react": patch
---

Fix the row highlight that plays after a cross-link jump. The shared `tree.css`
these packages bundle declared `@keyframes sn-flash` twice — once as the
accent-background flash for `.sn-node--flash`, and again further down as the
slide-up used by the action-feedback bar and the live-announcement log. The last
declaration of a name wins in CSS, so the row that a cross-link chip jumped to
translated a full row height up from below over 700ms instead of tinting and
fading in place. The node flash is now `@keyframes sn-node-flash`, leaving the
slide-up to its two intended callers.
