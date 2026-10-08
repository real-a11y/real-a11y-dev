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

/** The `KeyboardEvent` fields each key travels with. */
export const KEYS = {
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
} as const;

type KeySpec = (typeof KEYS)[keyof typeof KEYS];

/** Send one of `KEYS` through a `SendKey`. */
export function sendKeySpec(
  onSendKey: SendKey,
  spec: KeySpec,
  modifiers?: { shift?: boolean },
): void {
  onSendKey(spec.key, spec.code, spec.keyCode, modifiers);
}

/** The bar's buttons. `name` overrides the visible text only where that text
 *  is a symbol a screen reader reads badly or not at all. */
const BAR: Array<{
  spec: KeySpec;
  shift?: boolean;
  text: string;
  title: string;
  name?: string;
}> = [
  { spec: KEYS.Escape, text: "Esc", title: "Send Escape key" },
  { spec: KEYS.Tab, text: "Tab", title: "Send Tab key" },
  { spec: KEYS.Tab, shift: true, text: "Shift+Tab", title: "Send Shift+Tab" },
  { spec: KEYS.Enter, text: "Enter", title: "Send Enter key" },
  { spec: KEYS.Space, text: "Space", title: "Send Space key" },
  {
    spec: KEYS.ArrowDown,
    text: "↓",
    title: "Send Down arrow",
    name: "Send Down Arrow",
  },
  {
    spec: KEYS.ArrowUp,
    text: "↑",
    title: "Send Up arrow",
    name: "Send Up Arrow",
  },
];

export function SendKeyBar({ onSendKey }: { onSendKey: SendKey }) {
  return (
    <div
      class="sn-keyboard-bar"
      role="toolbar"
      aria-label="Send keyboard events to page"
    >
      <span class="sn-keyboard-label">Send key:</span>
      {BAR.map(({ spec, shift, text, title, name }) => (
        <button
          key={text}
          class="sn-key-btn"
          onClick={() =>
            sendKeySpec(onSendKey, spec, shift ? { shift } : undefined)
          }
          title={title}
          aria-label={name}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * "Dialog: <name>" with a button that sends Escape to close it, inside a
 * live region that stays mounted while no dialog is open, so the indicator
 * is announced when it appears: most screen readers ignore a live region
 * that arrives already holding its text. Renders nothing visible without a
 * dialog.
 */
export function DialogIndicator({
  dialog,
  onEscape,
}: {
  /** The open modal dialog, or null when there is none. */
  dialog: { name: string } | null;
  onEscape: () => void;
}) {
  return (
    <div class={dialog ? "sn-dialog-indicator" : undefined} role="status">
      {dialog && (
        <>
          <span class="sn-dialog-label">Dialog: {dialog.name || "Modal"}</span>
          <button
            class="sn-key-btn"
            onClick={onEscape}
            title="Send Escape key to close dialog"
          >
            Press ESC
          </button>
        </>
      )}
    </div>
  );
}
