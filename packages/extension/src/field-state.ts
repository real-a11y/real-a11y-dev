import { isSensitiveField } from "@real-a11y-dev/core";

import type { SelectOption } from "./types.js";

/** The panel's inline-input state for a field element, as returned to the
 *  side panel in response to `GET_FIELD_STATE`. */
export type FieldState =
  | { success: false }
  | {
      success: true;
      /** `"select"` for a native `<select>`, otherwise the input type
       *  (`"text"`, `"email"`, …). Custom contenteditable widgets report
       *  `"text"`. */
      type: string;
      /** Current value. Always `""` for a sensitive field (see below). */
      value: string;
      placeholder?: string;
      options?: SelectOption[];
    };

/**
 * Is this element an editable **contenteditable host** — a custom text widget
 * built as a `<div>`/`<span>` with `contenteditable`, exposed via an ARIA role
 * like `textbox`/`combobox`/`searchbox`? This is how rich editors that a native
 * `<input>` can't express are built: Slack's message box and search (Quill),
 * Notion, Google Docs, and ProseMirror/Lexical-based editors. Mirrors
 * `ActionDispatcher`'s own contenteditable detection so the panel offers text
 * entry for exactly the elements the dispatcher can (best-effort) type into.
 *
 * We read the `contenteditable` attribute in addition to `isContentEditable`
 * because jsdom doesn't compute inherited editability — the attribute check is
 * the reliable signal there (and matches the direct `contenteditable="true"`
 * that these widgets set on the editable element itself).
 */
function isEditableHost(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable) return true;
  const ce = el.getAttribute("contenteditable");
  return ce === "" || ce === "true" || ce === "plaintext-only";
}

/**
 * Compute the side panel's inline-input state for a field element. Pure and
 * DOM-only, so it is unit-tested directly. Returns `{ success: false }` for
 * anything that isn't a fillable field.
 *
 * A sensitive field (password, credit-card, etc.) never reveals its current
 * value to the panel — it reports `value: ""`. The field can still be typed
 * into, since the panel overwrites; it just can't read back the secret.
 */
export function computeFieldState(el: Element): FieldState {
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const select = el as HTMLSelectElement;
    // A payment select (e.g. autocomplete="cc-exp-month") is sensitive: keep
    // the option list so the picker still renders, but don't reveal which one
    // is currently chosen.
    const sensitive = isSensitiveField(select);
    const options: SelectOption[] = Array.from(select.options).map((opt) => ({
      value: opt.value,
      label: opt.textContent?.trim() || opt.value,
      selected: sensitive ? false : opt.selected,
    }));
    return {
      success: true,
      type: "select",
      value: sensitive ? "" : select.value,
      options,
    };
  }

  if (tag === "input" || tag === "textarea") {
    const input = el as HTMLInputElement;
    return {
      success: true,
      type: input.type || "text",
      value: isSensitiveField(input) ? "" : input.value,
      placeholder: input.placeholder || "",
    };
  }

  // Custom text widget (contenteditable). There is no `.value`; the current
  // text is its `textContent`. Trim to shed the framework whitespace these
  // editors leave behind (e.g. Quill's trailing newline / an empty
  // `<p><br></p>`), which would otherwise show as blank-but-not-empty.
  if (isEditableHost(el)) {
    return {
      success: true,
      type: "text",
      value: isSensitiveField(el) ? "" : (el.textContent ?? "").trim(),
      placeholder: el.getAttribute("aria-placeholder") ?? "",
    };
  }

  return { success: false };
}
