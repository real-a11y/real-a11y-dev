import { useEffect, useId, useState } from "react";

import type {
  ComboboxAsyncExampleProps,
  ComboboxAsyncOptionDef,
} from "./types.js";

const DATASET: ComboboxAsyncOptionDef[] = [
  { id: "alpha", label: "Alpha" },
  { id: "bravo", label: "Bravo" },
  { id: "charlie", label: "Charlie" },
  { id: "delta", label: "Delta" },
  { id: "echo", label: "Echo" },
  { id: "foxtrot", label: "Foxtrot" },
  { id: "golf", label: "Golf" },
  { id: "hotel", label: "Hotel" },
  { id: "india", label: "India" },
  { id: "juliet", label: "Juliet" },
];

// Hand-rolled "broken" async Combobox. Beyond the role-chain failures
// the basic Broken combobox has (no combobox/listbox/option roles),
// this variant adds the *async-specific* failures:
//
//   1. NO aria-busy on the dropdown during the fetch. AT users get
//      no signal that a request is in flight — silence between
//      keystroke and result.
//
//   2. NO live region announcing result count. After the dropdown
//      updates, screen reader users hear nothing about how many
//      options arrived, or that the search returned zero results.
//
//   3. The dropdown unmounts while loading (showing nothing) so
//      even if AT cared about busy state, there'd be no element to
//      mark busy.
//
// Visually identical to the correct variant — same input, same
// dropdown — but the async state changes are silent to AT.
export function ComboboxAsyncBroken({
  label,
  placeholder,
  latencyMs = 600,
}: ComboboxAsyncExampleProps) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ComboboxAsyncOptionDef[]>(DATASET);

  useEffect(() => {
    setIsLoading(true);
    const t = setTimeout(() => {
      const lowered = query.toLowerCase();
      setResults(
        DATASET.filter((o) => o.label.toLowerCase().includes(lowered)),
      );
      setIsLoading(false);
    }, latencyMs);
    return () => clearTimeout(t);
  }, [query, latencyMs]);

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
            minWidth: 200,
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
      {open && !isLoading ? (
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
            minWidth: 220,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            zIndex: 10,
          }}
        >
          {results.length === 0 ? (
            <li
              style={{
                padding: "6px 10px",
                font: "inherit",
                color: "var(--vp-c-text-2, #666)",
              }}
            >
              No results
            </li>
          ) : (
            results.map((opt) => (
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
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
