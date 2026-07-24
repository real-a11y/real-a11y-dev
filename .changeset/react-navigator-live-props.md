---
"@real-a11y-dev/react": patch
---

Fix `<SemanticNavigator>` freezing inspector config props after mount. `theme`, `interactive`, `highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate`, and `enablePicker` now remount when they change (they were closed over in an effect that only depended on root/mount/host). `onNodeSelect` / `onAction` use ref-backed stable wrappers so a parent that recreates the callback each render always invokes the latest closure — previously handlers read stale state indefinitely. The misleading "updated imperatively below" comment is gone; only `mode` still updates via `setViewMode` without remounting. (`styleNonce` remains mount-only — the inspector reuses the host's shadow root and injects the stylesheet once.)
