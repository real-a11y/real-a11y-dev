import { render } from "preact";

import { App } from "./App.js";
import { DogfoodPanel } from "./DogfoodPanel.js";
import "@ui-styles/tree.css";
import "./export-menu.css";
import "./empty-state.css";

// `__DOGFOOD__` is a build-time constant — true only in the `DOGFOOD=1` build,
// so the dev-only `DogfoodPanel` diagnostics widget below is dead-code-
// eliminated from the store build. It no longer gates native mode itself:
// `chrome.debugger` and the `NATIVE_*` message handlers (`native/index.ts`)
// are compiled into every build now and ship in the real manifest — off by
// default behind the runtime `settings.nativeModeEnabled` flag, not a
// build-time one. See CLAUDE.md's "extension has a native path now" section.
declare const __DOGFOOD__: boolean;
const dogfood = typeof __DOGFOOD__ !== "undefined" && __DOGFOOD__;

// In the dogfood build the panel and the App share `#root`, which is
// `height:100%; overflow:hidden`. Rendered as plain siblings the panel's height
// is ADDED to an already-full, non-scrollable box, so it clips the bottom of the
// App by exactly its own height — worst when expanded, which is what DOGFOOD.md
// tells the dogfooder to do. A flex column gives the panel its natural height
// and lets the App take the remainder (`min-height:0` so it may shrink below its
// content and scroll internally, as `.sn-root` expects).
//
// The store build renders `<App />` alone, exactly as it did before native mode
// existed — no wrapper, no Fragment.
render(
  dogfood ? (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <DogfoodPanel />
      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <App />
      </div>
    </div>
  ) : (
    <App />
  ),
  document.getElementById("root")!,
);
