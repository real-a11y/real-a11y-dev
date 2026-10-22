import { isSensitiveField } from "@real-a11y-dev/core";

import { pageText } from "./page-text.js";
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
      /** Current value. Always `""` when `valueWithheld` is set. */
      value: string;
      placeholder?: string;
      options?: SelectOption[];
      /** Set for a field whose value `value` leaves out (ADR-0001): a
       *  sensitive field, empty or not, and an editor holding one. For a
       *  `<select>` that includes which option is chosen. The panel's edit
       *  box hides what is typed into such a field. */
      valueWithheld?: true;
      /** Set for a contenteditable editor, whose `value` is only the text it
       *  holds: a retype replaces everything in it — formatting, images,
       *  controls — with what is typed. The panel's edit box takes a submit
       *  with no edit as no change for it. */
      editor?: true;
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
 * Does a sensitive field sit inside this element? An editor's value is the
 * text it holds, so one holding a card input is withheld whole, as the native
 * read withholds it (`pageReadValue`): a value read from around a secret
 * fails closed.
 */
function holdsSensitiveField(el: Element): boolean {
  return Array.from(el.querySelectorAll("input, textarea, select")).some(
    (control) => isSensitiveField(control),
  );
}

/**
 * Compute the side panel's inline-input state for a field element. Pure and
 * DOM-only, so it is unit-tested directly. Returns `{ success: false }` for
 * anything that isn't a fillable field.
 *
 * A sensitive field (password, credit-card, etc.) never reveals its current
 * value to the panel — it reports `value: ""` — and says so with
 * `valueWithheld`, empty or not, so the panel's edit box hides what is typed
 * into it. The field can still be typed into, since the panel overwrites; it
 * just can't read back the secret.
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
      // `:disabled`, not `.disabled`: a disabled `<optgroup>` disables its
      // options without setting their own attribute.
      ...(opt.matches(":disabled") ? { disabled: true } : {}),
    }));
    return {
      success: true,
      type: "select",
      value: sensitive ? "" : select.value,
      options,
      ...(sensitive ? { valueWithheld: true as const } : {}),
    };
  }

  if (tag === "input" || tag === "textarea") {
    const input = el as HTMLInputElement;
    const sensitive = isSensitiveField(input);
    return {
      success: true,
      type: input.type || "text",
      value: sensitive ? "" : input.value,
      placeholder: input.placeholder || "",
      ...(sensitive ? { valueWithheld: true as const } : {}),
    };
  }

  // Custom text widget (contenteditable). There is no `.value`; the current
  // text is its text content, less any control's child text — a nested
  // `<textarea>`'s is its default, which for a sensitive one is the secret.
  // An editor holding a sensitive field is withheld whole (see
  // `holdsSensitiveField`). Trim to shed the framework whitespace these
  // editors leave behind (e.g. Quill's trailing newline / an empty
  // `<p><br></p>`), which would otherwise show as blank-but-not-empty. That
  // text is all of the editor the edit box gets, hence `editor`.
  if (isEditableHost(el)) {
    const sensitive = holdsSensitiveField(el);
    return {
      success: true,
      type: "text",
      value: sensitive ? "" : pageText(el).trim(),
      placeholder: el.getAttribute("aria-placeholder") ?? "",
      ...(sensitive ? { valueWithheld: true as const } : {}),
      editor: true,
    };
  }

  return { success: false };
}
