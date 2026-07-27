---
"@real-a11y-dev/semantic-navigator-ui": patch
---

Let keyboard users decrement sliders/spinbuttons. The ▼/▲ stepper buttons are mouse-only (`tabIndex={-1}`), and Enter always hit `getPrimaryAction` which prefers `increment` — so a keyboard-only panel user could raise a value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter` decrement (tree + form filtered list).
