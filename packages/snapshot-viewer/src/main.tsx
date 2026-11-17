import "@ui-styles/tree.css";
import "@ui-styles/tree-changes.css";
import "./viewer.css";

import { render } from "preact";

import { App } from "./App.js";

render(<App />, document.getElementById("app")!);
