/**
 * The keyboard bar under the tree, and the dialog indicator above it — shared
 * by the DOM tree (`App.tsx`) and the native one (`NativeTreeView.tsx`).
 *
 * Both send a key to whatever has focus on the page through the content
 * script's `SEND_KEY`, which runs in native mode too: the panel reaches
 * NATIVE only after the DOM producer has connected. Which tree is showing
 * decides only what is read again afterwards, so that stays with the caller.
 */

export type SendKey = (
  key: string,
  code: string,
  keyCode: number,
  modifiers?: { shift?: boolean },
) => void;

export function SendKeyBar({ onSendKey }: { onSendKey: SendKey }) {
  return (
    <div
      class="sn-keyboard-bar"
      role="toolbar"
      aria-label="Send keyboard events to page"
    >
      <span class="sn-keyboard-label">Send key:</span>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("Escape", "Escape", 27)}
        title="Send Escape key"
      >
        Esc
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("Tab", "Tab", 9)}
        title="Send Tab key"
      >
        Tab
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("Tab", "Tab", 9, { shift: true })}
        title="Send Shift+Tab"
      >
        Shift+Tab
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("Enter", "Enter", 13)}
        title="Send Enter key"
      >
        Enter
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey(" ", "Space", 32)}
        title="Send Space key"
      >
        Space
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("ArrowDown", "ArrowDown", 40)}
        title="Send Down arrow"
      >
        {"↓"}
      </button>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("ArrowUp", "ArrowUp", 38)}
        title="Send Up arrow"
      >
        {"↑"}
      </button>
    </div>
  );
}

/** "Dialog: <name>" with a button that sends Escape to close it. */
export function DialogIndicator({
  name,
  onSendKey,
}: {
  name: string;
  onSendKey: SendKey;
}) {
  return (
    <div class="sn-dialog-indicator" role="status">
      <span class="sn-dialog-label">Dialog: {name || "Modal"}</span>
      <button
        class="sn-key-btn"
        onClick={() => onSendKey("Escape", "Escape", 27)}
        title="Send Escape key to close dialog"
      >
        Press ESC
      </button>
    </div>
  );
}
