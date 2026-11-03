import { useState, useRef, useEffect, useCallback, useId } from "preact/hooks";

import type { FieldState } from "../field-state.js";
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
   * Which producer's node `nodeId` resolves against — the page's own walk's
   * per-frame ids (a TAB row's), or a native tree's `ax-dom-<backendNodeId>`
   * ids. Absent
   * means `"dom"`, the only producer that opened this
   * panel before native mode existed — every pre-existing call site is still
   * correct with no changes. `App.tsx`'s submit handler reads this to decide
   * which wire message (`DISPATCH_ACTION` vs `NATIVE_ACT`) a submission
   * becomes; this component itself never branches on it.
   */
  source?: "dom" | "native";
  /**
   * Set when `value` was substituted empty for a field whose real value is
   * withheld (R1) — a DOM field's (see {@link domTextInputState}) or a
   * native one's — and on every native box that opens empty, since a native
   * row doesn't show all its field holds: an editor's content can't be
   * retyped from, and an editor holding only an image shows no value at
   * all — see `App.tsx`'s `handleNativeActivate`.
   * Submitting with NO edit (still empty) cancels instead of dispatching:
   * without this, a click-through submit would silently blank the user's
   * real, still-live value on the page for a field they never touched. Any
   * edit submits normally — a typed replacement, and also text typed and
   * then deleted, which is how a user deliberately empties the field.
   */
  blockEmptySubmit?: boolean;
  /**
   * Set when the box holds less than its field: a TAB row editor's box opens
   * on its text alone (see {@link domTextInputState}), and a retype replaces
   * everything in the editor — its formatting, images and controls too.
   * Submitting with NO edit cancels instead of dispatching, prefilled or
   * empty: it would type that text back over them. Any edit submits
   * normally, as for `blockEmptySubmit`.
   */
  blockUntouchedSubmit?: boolean;
  /**
   * The field's value is withheld (ADR-0001): a sensitive select marks no
   * current option, and the feedback after a choice names the field, never
   * the option chosen.
   */
  valueWithheld?: boolean;
  /**
   * The field takes more than one line — a `<textarea>`, an editor: its
   * field state's `multiline` (see `computeFieldState`) or Chromium's state
   * of that name. The box is then a `<textarea>`, where Shift+Enter starts a
   * new line and Enter still sets the value. A one-line `<input>` strips line
   * breaks from what it holds, so an edit used to type the field's lines
   * back as one. A box whose `value` holds a line break is multi-line however
   * this is set, and a masked box never is: only a password input hides what
   * is typed.
   */
  multiline?: boolean;
}

/**
 * The edit box a TAB row opens, from its field's `GET_FIELD_STATE` reply
 * (`computeFieldState`). A field whose value is withheld (ADR-0001) arrives
 * without it, so its box opens empty in its place: it hides what is typed,
 * for every such field, empty or not (a password field's own type used to be
 * the only thing that hid it), and an untouched Enter cancels rather than
 * type `""` over the real value. An editor's box opens on its text, which is
 * all of the editor the box can hold, so an untouched Enter cancels there
 * too, rather than type that text back in place of everything in it. A
 * redaction gate — `scripts/pr-risk.mjs` grades a change to it as such.
 *
 * @internal
 */
export function domTextInputState(
  nodeId: string,
  label: string,
  field: Extract<FieldState, { success: true }>,
): InputPanelState {
  const withheld = field.valueWithheld === true;
  return {
    type: "text",
    nodeId,
    label,
    value: withheld ? "" : field.value || "",
    inputType: withheld ? "password" : field.type,
    ...(field.multiline === true ? { multiline: true } : {}),
    placeholder: field.placeholder,
    ...(withheld ? { blockEmptySubmit: true } : {}),
    ...(field.editor === true ? { blockUntouchedSubmit: true } : {}),
  };
}

interface InputPanelProps {
  state: InputPanelState;
  onSubmit: (nodeId: string, value: string) => void;
  onCancel: () => void;
}

export function InputPanel({ state, onSubmit, onCancel }: InputPanelProps) {
  // One editor per field. Opening another field's box while this one is open
  // re-renders the panel in place, and an editor reused for it would keep what
  // was typed for the first field while taking the second's mask: a password
  // typed into a masked box would show in the next, unmasked one, and Enter
  // would type it into that field. A reused picker would keep the first
  // list's place.
  const field = `${state.source ?? "dom"}:${state.nodeId}`;
  if (state.type === "text") {
    return (
      <TextInput
        key={field}
        state={state}
        onSubmit={(v) => onSubmit(state.nodeId, v)}
        onCancel={onCancel}
      />
    );
  }

  return (
    <SelectPicker
      key={field}
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
  // Whether the user has typed at all. `blockEmptySubmit` and
  // `blockUntouchedSubmit` guard only the UNTOUCHED submit: a box that opened
  // empty in place of a value it can't show, or on less than its field holds,
  // says nothing about the field until the user types, but typing and then
  // clearing it is a deliberate "empty this field".
  const [edited, setEdited] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const masked = state.inputType === "password";
  // A one-line input would strip the line breaks from what the box holds, so
  // holding one makes the box multi-line whatever the field says.
  const multiline =
    !masked && (state.multiline === true || /[\r\n]/.test(state.value));

  useRestoreFocusOnClose(dialogRef);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const field = inputRef.current ?? areaRef.current;
    field?.focus();
    field?.select();
  }, []);

  const submit = useCallback(() => {
    const untouchedCancels =
      state.blockUntouchedSubmit || (state.blockEmptySubmit && value === "");
    if (!edited && untouchedCancels) onCancel();
    else onSubmit(value);
  }, [
    state.blockUntouchedSubmit,
    state.blockEmptySubmit,
    edited,
    value,
    onSubmit,
    onCancel,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        // Shift+Enter starts a new line in a multi-line box.
        if (multiline && e.shiftKey) return;
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [multiline, submit, onCancel],
  );

  const handleInput = (e: Event) => {
    setValue((e.target as HTMLInputElement | HTMLTextAreaElement).value);
    setEdited(true);
  };

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
      {multiline ? (
        // Enter sets the value here too, which a multi-line field's own
        // Enter wouldn't, so the hint that says so is its description.
        <textarea
          ref={areaRef}
          id={fieldId}
          class="sn-input-panel-field"
          rows={4}
          value={value}
          placeholder={state.placeholder || ""}
          aria-describedby={hintId}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={inputRef}
          id={fieldId}
          class="sn-input-panel-field"
          type={masked ? "password" : "text"}
          value={value}
          placeholder={state.placeholder || ""}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      )}
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
      <div id={hintId} class="sn-input-panel-hint">
        <kbd>Enter</kbd> set value &middot;{" "}
        {multiline && (
          <>
            <kbd>Shift+Enter</kbd> new line &middot;{" "}
          </>
        )}
        <kbd>Esc</kbd> cancel
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
