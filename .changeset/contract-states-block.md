---
"@real-a11y-dev/testing": patch
---

`toMatchA11yContract` checks a `{…}` states block written on a contract line, for tree text that prints one (`checkbox "Subscribe" {checked}`).

- **Containment** (the default): the received node must carry at least the block's tokens, in any order. A quoted value is compared decoded, with typography folded as in names. `checkbox "Subscribe" {checked}` fails against an unchecked box, and the failure names the missing tokens.
- **`{ strict: true }`:** a block must hold exactly the received node's tokens, in any order, byte for byte. The failure shows each side's block as written.
- **`{}`** asserts that the node has no states, in both modes.
- **A line without a block** says nothing about states, in both modes, so existing contracts match as before.
- **Against a DOM Element**, the block is checked against the Element's own tree text, which prints states too. A `haspopup` or `roledescription` token throws there, with or without `.not`, rather than pass on a check it can't make: the DOM producer reads neither.
- **Field values:** a line's `= "value"` is read as the value, not as part of the name, so `textbox "Email"` matches a received `textbox "Email" = "a@b.c"`, where it failed before; a contract that writes `= "value"` asserts it, and against a DOM Element is checked against the tree with values on. A name the serializer prints with ` = "` inside it stays the name.
