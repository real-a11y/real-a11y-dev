import { useState, useRef, useEffect, useCallback, useId } from "preact/hooks";

import type { SelectOption } from "../types.js";

import { useFocusTrap, useRestoreFocusOnClose } from "./focus-hooks.js";

export interface InputPanelState {
  type: "text" | "select";
  nodeId: string;
  label: string;
  value: string;
  inputType?: string;
  placeholder?: string;
  options?: SelectOption[];
  /**
   * Which producer's node `nodeId` resolves against — the DOM tree's own
   * per-frame ids, or a native tree's `ax-dom-<backendNodeId>` ids. Absent
   * means `"dom"`, the only producer that opened this
   * panel before native mode existed — every pre-existing call site is still
   * correct with no changes. `App.tsx`'s submit handler reads this to decide
   * which wire message (`DISPATCH_ACTION` vs `NATIVE_ACT`) a submission
   * becomes; this component itself never branches on it.
   */
  source?: "dom" | "native";
  /**
   * Set only when `value` was substituted empty for a native field whose
   * real value is redacted (R1), or that a retype cannot start from (an
   * editor's content) — see `App.tsx`'s `handleNativeActivate`.
   * Submitting with NO edit (still empty) cancels instead of dispatching:
   * without this, a click-through submit would silently blank the user's
   * real, still-live value on the page for a field they never touched. Any
   * edit submits normally — a typed replacement, and also text typed and
   * then deleted, which is how a user deliberately empties the field.
   */
  blockEmptySubmit?: boolean;
  /**
   * The field's value is withheld (ADR-0001): a sensitive select marks no
   * current option, and the feedback after a choice names the field, never
   * the option chosen.
   */
  valueWithheld?: boolean;
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
  // Whether the user has typed at all. `blockEmptySubmit` guards only the
  // UNTOUCHED submit: a field that opened empty in place of a value it can't
  // show says nothing about that value until the user types, but typing and
  // then clearing it is a deliberate "empty this field".
  const [edited, setEdited] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();

  useRestoreFocusOnClose(dialogRef);
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = useCallback(() => {
    if (state.blockEmptySubmit && !edited && value === "") onCancel();
    else onSubmit(value);
  }, [state.blockEmptySubmit, edited, value, onSubmit, onCancel]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [submit, onCancel],
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
        onInput={(e) => {
          setValue((e.target as HTMLInputElement).value);
          setEdited(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <div class="sn-input-panel-actions">
        <button class="sn-input-panel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          class="sn-input-panel-btn sn-input-panel-btn--primary"
          onClick={submit}
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

  useRestoreFocusOnClose(dialogRef);
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
          if (options[selectedIndex] && !options[selectedIndex].disabled) {
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
            class={`sn-select-option ${i === selectedIndex ? "sn-select-option--selected" : ""}${opt.disabled ? " sn-select-option--disabled" : ""}`}
            role="option"
            // Listed so the picker matches the page's own, but not choosable:
            // a user couldn't pick it on the page either.
            aria-disabled={opt.disabled ? "true" : undefined}
            // The field's own current option, as the dot shows — not the
            // keyboard position, which `aria-activedescendant` carries. A
            // sensitive select reports none, and the first option must not
            // be announced as chosen just because the cursor starts there.
            aria-selected={opt.selected}
            data-opt-index={i}
            onClick={() => {
              setSelectedIndex(i);
              if (!opt.disabled) onSubmit(opt.value);
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
          disabled={
            options.length === 0 || options[selectedIndex]?.disabled === true
          }
          onClick={() =>
            options[selectedIndex] &&
            !options[selectedIndex].disabled &&
            onSubmit(options[selectedIndex].value)
          }
        >
          Select
        </button>
      </div>
    </div>
  );
}
