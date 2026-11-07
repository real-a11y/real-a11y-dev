---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<form>` and its controls when one of the controls is named `tagName` or `getAttribute`. A form shadows a DOM member with a control of the same name, and the in-page tree builder read both plainly, so the read threw and the form was dropped with every field and button inside it. The panels, `testing` assertions and snapshots, `real-a11y tabs` and the MCP `get_tab_order` tool now list those controls, and audits now report an unlabelled field inside such a form. Saved snapshots of a page with such a form will change. Help text whose only control sits in such a form is now kept as a node of its own, like any help text that holds a control.
