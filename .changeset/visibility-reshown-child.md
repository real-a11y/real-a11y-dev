---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Keep a child that sets `visibility:visible` inside a `visibility:hidden` element. The DOM-produced tree used to drop the whole subtree of a `visibility:hidden` element, so a rendered paragraph or control inside it never appeared, which Chromium and the native tree do show. The hidden element itself still leaves the tree, a child that inherits `visibility:hidden` still stays out, and `aria-hidden`, `display:none`, `hidden` and `inert` still hide their whole subtree. An `aria-describedby` target whose only control sits in such a child now keeps that control. Saved DOM-produced snapshots of pages that re-show content this way will churn.
