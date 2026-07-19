import type { CSSProperties } from "react";

/**
 * Slack's composer widgets, replicated with plain markup (no editor library) —
 * the exact ARIA shapes Slack ships, so the Semantic Navigator addon shows how
 * they extract:
 *
 * - **Message box** — a `contenteditable` `<div role="textbox">` (W3C APG
 *   multi-line Textbox pattern).
 * - **Search** — an EDITABLE `<div role="combobox">` with `aria-autocomplete`
 *   controlling a listbox popup (ARIA 1.2 editable-combobox pattern).
 *
 * Both are the `contenteditable`-hosted variants a native `<input>` can't
 * express — the case that needs the extension's contenteditable field-state +
 * the editable-combobox classification to be typeable in the panel.
 */
export function SlackComposer() {
  const box: CSSProperties = {
    border: "1px solid #8d8d8d",
    borderRadius: 4,
    padding: "8px 12px",
    minHeight: 20,
    font: "15px system-ui, sans-serif",
  };

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 480 }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span>Message box (contenteditable role=textbox)</span>
        <div
          className="ql-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Message to general"
          aria-multiline="true"
          style={{ ...box, minHeight: 44 }}
        >
          <p>
            <br />
          </p>
        </div>
      </label>

      <div style={{ display: "grid", gap: 6 }}>
        <span>Search (editable role=combobox)</span>
        <div
          className="ql-editor"
          contentEditable
          suppressContentEditableWarning
          role="combobox"
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded={false}
          aria-controls="slack-suggestions"
          aria-multiline="false"
          style={box}
        >
          <p>
            <br />
          </p>
        </div>
        <ul
          id="slack-suggestions"
          role="listbox"
          aria-label="Suggestions"
          style={{ margin: 0, padding: 0, listStyle: "none" }}
        />
      </div>
    </div>
  );
}
