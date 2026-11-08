---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

The DOM producer now reports `readonly` for an `<input>` or `<textarea>` that carries the HTML `readonly` attribute, as HTML-AAM maps it to `aria-readonly="true"` (and the attribute wins over an `aria-readonly` on the same element). Before, only an authored `aria-readonly` was read, so a read-only field showed as an editable textbox with no `readonly` badge. Toggling the attribute on a live tree now updates the state. Saved snapshots and baselines that contain a read-only field will churn: those nodes gain `readonly`.
