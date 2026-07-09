---
"@real-a11y-dev/core": patch
---

Stop using a text input's value as its accessible name. `computeRawAccessibleName` returned `input.value` for **any** input when no label matched, so an unlabeled `<input type="text">` the user typed "John" into was named "John", and an unlabeled `<input type="checkbox">` inherited its default DOM value `"on"`. Both make a genuinely unlabeled control look labelled — the worst failure mode for an a11y tool, because `@real-a11y-dev/testing`'s `assertNoUnlabeledInteractive` would then pass a control that real screen readers announce as unlabeled.

Per HTML-AAM, `value` names only button-like inputs (`submit` / `reset` / `button`); text, checkbox, radio, and the rest do not use it. The value fallback is now gated to those types, and `title` is ordered before `placeholder` to match the spec. Labels, `aria-label`, and `aria-labelledby` still take precedence as before.
