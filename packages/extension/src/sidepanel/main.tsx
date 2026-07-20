import { render } from "preact";

import { App } from "./App.js";
import "@ui-styles/tree.css";
import "./export-menu.css";
import "./empty-state.css";

render(<App />, document.getElementById("root")!);
