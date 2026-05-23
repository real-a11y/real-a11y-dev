import { useId, useState } from "react";

import type { ComboboxExampleProps } from "./types.js";

// Hand-rolled "broken" combobox. Deliberately wrong on the role
// wiring and announcement axes:
//
//   1. Trigger is a plain <input type="text"> with NO role="combobox",
//      NO aria-expanded, NO aria-controls. Screen readers announce
//      it as a text field, not a combobox; nothing tells AT the input
//      owns a list of choices.
//
//   2. Dropdown is a plain <ul> of <li>s with NO role="listbox" /
//      role="option", and NO aria-activedescendant updates as the
//      user arrows around. The audit snapshot will show a "list" of
//      "listitem"s, not a "listbox" of "option"s.
//
//   3. Filtering is wired by the visible label as a textContent match
//      — fine functionally, but no result-count live region, no
//      announced "no results" state.
//
// Visually identical to ComboboxCorrect — input + chevron + dropdown
// — just no AT signal for the combobox role chain.
export function ComboboxBroken({
  label,
  options,
  placeholder,
}: ComboboxExampleProps) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <label id={labelId} style={{ font: "inherit" }}>
        {label}
      </label>
      <div style={{ display: "inline-flex" }}>
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          aria-labelledby={labelId}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRight: "none",
            borderRadius: "6px 0 0 6px",
            background: "var(--vp-c-bg-elv, #fff)",
            font: "inherit",
            minWidth: 180,
          }}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "0 10px",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: "0 6px 6px 0",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          ▾
        </button>
      </div>
      {open && filtered.length > 0 ? (
        <ul
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            minWidth: 200,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            zIndex: 10,
          }}
        >
          {filtered.map((opt) => (
            <li key={opt.id} style={{ margin: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setQuery(opt.label);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  border: "none",
                  borderRadius: 4,
                  background: "transparent",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
