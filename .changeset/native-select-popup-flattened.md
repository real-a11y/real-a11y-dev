---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer prints Chromium's internal popup node for a drop-down `<select>`. Chromium puts a `MenuListPopup` between the `combobox` and its options, a role that is not in ARIA, so `tree`, `audit`, `inspect`, `snapshot`, the MCP tools and the testing package's native mode printed `combobox "Sel" = "B"` > `MenuListPopup` > `option "A"`, `option "B"`, and `validate` rejected the role. The popup is now flattened: the options (and an `<optgroup>`'s `group`) sit directly under the combobox, which is the shape the DOM producer already prints for the same `<select>`. Saved native snapshots and baselines that contain a drop-down select will churn: re-record them. `NATIVE_AX_VOCABULARY_VERSION` goes to 12.
