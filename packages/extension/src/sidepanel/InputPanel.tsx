import type { RefObject } from "preact";
import { useState, useRef, useEffect, useCallback, useId } from "preact/hooks";

import type { SelectOption } from "../types.js";

/**
 * Everything inside the panel that Tab can reach. Its controls are only ever
 * enabled or disabled — never hidden — so matching on the selector alone is
 * enough; there is nothing here that needs a visibility check.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * `aria-modal` tells assistive tech that everything behind the dialog is
 * inert, so Tab has to actually honour that. Without this, focus walks out
 * into the toolbar rendered behind the panel while the screen reader still
 * believes it is inside a modal.
 *
 * Bound as a DOM listener on the dialog root rather than as a JSX `onKeyDown`:
 * the wrapper is a plain `role="dialog"` container, and hanging key handlers
 * on it is what `jsx-a11y/no-noninteractive-element-interactions` exists to
 * catch. Keydown bubbles here from whichever control has focus either way.
 */
function useFocusTrap(ref: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = root.ownerDocument.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

/**
 * The panel unmounts on submit and on cancel while it still contains focus,
 * which drops DOM focus to `<body>` and leaves a keyboard user Tabbing back
 * from the top of the panel. Return focus to whatever opened it instead — the
 * tree container, the filtered list or the tab sequence, depending on the view
 * the interaction started from.
 *
 * Must be called before any hook that moves focus into the dialog, so that it
 * captures the opener rather than the dialog's own initial focus target.
 */
function useRestoreFocusOnClose() {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // The opener can be gone by the time the panel closes — a re-extraction
      // replaces tree rows — and a detached element cannot take focus.
      if (opener?.isConnected) opener.focus();
    };
  }, []);
}

export interface InputPanelState {
  type: "text" | "select";
  nodeId: string;
  label: string;
  value: string;
  inputType?: string;
  placeholder?: string;
  options?: SelectOption[];
}

interface InputPanelProps {
  state: InputPanelState;
  onSubmit: (nodeId: string, value: string) => void;
  onCancel: () => void;
}

export function InputPanel({ state, onSubmit, onCancel }: InputPanelProps) {
  if (state.type === "text") {
    return (
      <TextInput
        state={state}
        onSubmit={(v) => onSubmit(state.nodeId, v)}
        onCancel={onCancel}
      />
    );
  }

  return (
    <SelectPicker
      state={state}
      onSubmit={(v) => onSubmit(state.nodeId, v)}
      onCancel={onCancel}
    />
  );
}

function TextInput({
  state,
  onSubmit,
  onCancel,
}: {
  state: InputPanelState;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(state.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();

  useRestoreFocusOnClose();
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit(value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [value, onSubmit, onCancel],
  );

  return (
    <div
      ref={dialogRef}
      class="sn-input-panel"
      role="dialog"
      aria-modal="true"
      aria-label={state.label}
    >
      <label class="sn-input-panel-label" for={fieldId}>
        {state.label}
      </label>
      <input
        ref={inputRef}
        id={fieldId}
        class="sn-input-panel-field"
        type={state.inputType === "password" ? "password" : "text"}
        value={value}
        placeholder={state.placeholder || ""}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
      />
      <div class="sn-input-panel-actions">
        <button class="sn-input-panel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          class="sn-input-panel-btn sn-input-panel-btn--primary"
          onClick={() => onSubmit(value)}
        >
          Set value
        </button>
      </div>
      <div class="sn-input-panel-hint">
        <kbd>Enter</kbd> set value &middot; <kbd>Esc</kbd> cancel
      </div>
    </div>
  );
}

function SelectPicker({
  state,
  onSubmit,
  onCancel,
}: {
  state: InputPanelState;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const options = state.options || [];
  const currentIndex = options.findIndex((o) => o.selected);
  const [selectedIndex, setSelectedIndex] = useState(
    currentIndex >= 0 ? currentIndex : 0,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useRestoreFocusOnClose();
  useFocusTrap(dialogRef);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-opt-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, options.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setSelectedIndex(options.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          if (options[selectedIndex]) {
            onSubmit(options[selectedIndex].value);
          }
          break;
        case "Escape":
          e.preventDefault();
          onCancel();
          break;
      }
    },
    [options, selectedIndex, onSubmit, onCancel],
  );

  return (
    <div
      ref={dialogRef}
      class="sn-input-panel"
      role="dialog"
      aria-modal="true"
      aria-label={state.label}
    >
      <div class="sn-input-panel-label">{state.label}</div>
      <div
        ref={listRef}
        class="sn-select-options"
        role="listbox"
        tabIndex={0}
        // Container-focus composite — announce the active option (see the tree
        // and FilteredList). Bounds-check selectedIndex so a shrunk option set
        // can't leave the reference dangling past the end.
        aria-activedescendant={
          selectedIndex >= 0 && selectedIndex < options.length
            ? `sn-select-opt-${selectedIndex}`
            : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {options.map((opt, i) => (
          <div
            key={opt.value}
            id={`sn-select-opt-${i}`}
            class={`sn-select-option ${i === selectedIndex ? "sn-select-option--selected" : ""}`}
            role="option"
            aria-selected={i === selectedIndex}
            data-opt-index={i}
            onClick={() => {
              setSelectedIndex(i);
              onSubmit(opt.value);
            }}
          >
            <span class="sn-select-check">
              {opt.selected ? "\u25CF" : "\u25CB"}
            </span>
            {opt.label}
          </div>
        ))}
        {options.length === 0 && (
          <div class="sn-empty">No options available</div>
        )}
      </div>
      <div class="sn-input-panel-actions">
        <button class="sn-input-panel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          class="sn-input-panel-btn sn-input-panel-btn--primary"
          disabled={options.length === 0}
          onClick={() =>
            options[selectedIndex] && onSubmit(options[selectedIndex].value)
          }
        >
          Select
        </button>
      </div>
    </div>
  );
}
