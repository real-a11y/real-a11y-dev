import { useState, useRef, useEffect, useCallback } from "preact/hooks";

import type { SelectOption } from "../types.js";

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
    <div class="sn-input-panel" role="dialog" aria-label={state.label}>
      <label class="sn-input-panel-label">{state.label}</label>
      <input
        ref={inputRef}
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
    <div class="sn-input-panel" role="dialog" aria-label={state.label}>
      <div class="sn-input-panel-label">{state.label}</div>
      <div
        ref={listRef}
        class="sn-select-options"
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {options.map((opt, i) => (
          <div
            key={opt.value}
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
