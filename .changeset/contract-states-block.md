---
"@real-a11y-dev/testing": patch
---

`toMatchA11yContract` checks a `{…}` states block written on a contract line, for tree text that prints one (`checkbox "Subscribe" {checked}`).

- **Containment** (the default): the received node must carry at least the block's tokens, in any order. A quoted value is compared decoded, with typography folded as in names. `checkbox "Subscribe" {checked}` fails against an unchecked box, and the failure names the missing tokens.
- **`{ strict: true }`:** a block must hold exactly the received node's tokens, in any order, byte for byte.
- **A line without a block** says nothing about states, in both modes, so existing contracts match as before.
