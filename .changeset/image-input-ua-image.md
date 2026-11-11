---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Keep the image Chromium draws inside an `<input type="image">` out of the native tree. The control is a `button` whose descendants are presentational, and its user-agent image showed as an unnamed `img` under a correctly named button, so `image-alt` warned about an element at `#alttext-image` that the page's author cannot edit. `real-a11y audit`, `tree` and `snapshot`, the MCP tools and `collectFindings` over a native tree no longer show it; an authored `<img>` or `role="img"` is still reported. The native vocabulary version moves to 11, so saved native snapshots of a page with an image input will churn: the `img` line under the button goes.
