import Quill from "quill";
import { useEffect, useRef } from "react";

import "quill/dist/quill.snow.css";

/**
 * A real [Quill](https://quilljs.com) rich-text editor — the same engine that
 * powers Slack's message composer and search. Quill's editable surface is a
 * `contenteditable` `<div class="ql-editor">`, i.e. a model-driven editor, not
 * a native `<input>`. We expose it as an ARIA `textbox` with a name (exactly
 * how Slack wires it up) so the Semantic Navigator addon shows it as a named,
 * editable textbox in the a11y tree.
 *
 * Use this story to see how the tree/actions look for a genuine rich editor
 * (contrast with `SlackComposer`, which hand-writes the same ARIA shape without
 * the library).
 */
export function QuillEditor() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const quill = new Quill(container, {
      theme: "snow",
      placeholder: "Message #general",
    });

    // Quill's editable root is a bare `contenteditable` div; name it and expose
    // the textbox role so it announces (and extracts) as a labelled textbox.
    const editor = quill.root;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "Message to general");
    editor.setAttribute("aria-multiline", "true");

    // Quill v2 has no `destroy()`; clearing the container drops the instance.
    return () => {
      container.innerHTML = "";
    };
  }, []);

  return <div style={{ maxWidth: 480 }} ref={containerRef} />;
}
