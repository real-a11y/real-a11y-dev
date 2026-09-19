import { render } from "preact";

import { App } from "./App.js";
import { DogfoodPanel } from "./DogfoodPanel.js";
import "@ui-styles/tree.css";
import "./export-menu.css";
import "./empty-state.css";

// `__DOGFOOD__` is a build-time constant — true only in the `DOGFOOD=1` build,
// so the dev-only `chrome.debugger` panel is dead-code-eliminated from the store
// build (which never carries the native mode or its `debugger` permission).
declare const __DOGFOOD__: boolean;
const dogfood = typeof __DOGFOOD__ !== "undefined" && __DOGFOOD__;

render(
  <>
    {dogfood && <DogfoodPanel />}
    <App />
  </>,
  document.getElementById("root")!,
);
