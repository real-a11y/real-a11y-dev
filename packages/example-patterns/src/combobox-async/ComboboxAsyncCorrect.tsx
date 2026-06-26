import { useEffect, useId, useState } from "react";
import {
  Button,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";

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

// Correct APG async Combobox.
//
// On top of the basic Combobox role chain (role="combobox" +
// aria-expanded + aria-controls + aria-autocomplete + role="listbox"
// popover with aria-activedescendant), the async variant has two
// additional accessibility requirements:
//
//   1. **`aria-busy="true"`** on the listbox while a fetch is in
//      flight — so AT can announce "loading" instead of "no results"
//      during the round-trip gap.
//
//   2. **A `role="status"` live region** announcing the result count
//      ("3 options available" / "no results") so screen reader users
//      know when filtering finishes and how much landed.
//
// The popover deliberately stays mounted while loading so the busy
// state and status region remain in the AT tree across the fetch.
export function ComboboxAsyncCorrect({
  label,
  placeholder,
  latencyMs = 600,
}: ComboboxAsyncExampleProps) {
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ComboboxAsyncOptionDef[]>(DATASET);
  const statusId = useId();

  useEffect(() => {
    setIsLoading(true);
    const t = setTimeout(() => {
      const lowered = filter.toLowerCase();
      setResults(
        DATASET.filter((o) => o.label.toLowerCase().includes(lowered)),
      );
      setIsLoading(false);
    }, latencyMs);
    return () => clearTimeout(t);
  }, [filter, latencyMs]);

  // Status announcement — published to a polite live region after
  // each settled fetch. Empty string while loading so we don't
  // announce a stale count.
  const statusMessage = isLoading
    ? "Loading options…"
    : results.length === 0
      ? "No options available."
      : `${results.length} option${results.length === 1 ? "" : "s"} available.`;

  return (
    <ComboBox
      inputValue={filter}
      onInputChange={setFilter}
      style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}
    >
      <Label style={{ font: "inherit" }}>{label}</Label>
      <div style={{ display: "inline-flex" }}>
        <Input
          placeholder={placeholder}
          aria-describedby={statusId}
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
        <Button
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
        </Button>
      </div>
      <Popover>
        <ListBox
          aria-busy={isLoading || undefined}
          renderEmptyState={() => (
            <div
              style={{
                padding: "6px 10px",
                font: "inherit",
                color: "var(--vp-c-text-2, #666)",
              }}
            >
              {isLoading ? "Loading…" : "No results"}
            </div>
          )}
          style={{
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 220,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            outline: "none",
          }}
        >
          {isLoading
            ? null
            : results.map((opt) => (
                <ListBoxItem
                  key={opt.id}
                  id={opt.id}
                  textValue={opt.label}
                  style={({ isFocused }) => ({
                    padding: "6px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    font: "inherit",
                    outline: "none",
                    background: isFocused
                      ? "var(--vp-c-default-soft, rgba(0,0,0,0.05))"
                      : "transparent",
                  })}
                >
                  {opt.label}
                </ListBoxItem>
              ))}
        </ListBox>
      </Popover>
      {/* role="status" live region — aria-live="polite" is implicit.
          Real A11y consumers see this row in the panel; the visual
          presentation is the sr-only clip pattern (intentionally
          accessible to AT, visually hidden). */}
      <div
        id={statusId}
        role="status"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {statusMessage}
      </div>
    </ComboBox>
  );
}
