/**
 * The `--step` mini-language for `real-a11y interact`.
 *
 * A step is written in the vocabulary the tree already prints, so a line from
 * `real-a11y tree` can be pasted almost verbatim:
 *
 *   click  button "Save"
 *   click  button "Save" nth=2
 *   focus  textbox "Email"
 *   type   textbox "Email" = someone@example.com
 *
 * The name is optional (omit to match any name, `""` to match only unlabeled
 * controls) and `nth=` is 1-based in document order — the same spelling the
 * ambiguity error prints, so the fix is copy-paste.
 *
 * This module is pure string → data. It never touches a browser, so every
 * malformed-input message is unit-testable without launching one.
 */

import { CliError } from "./exit.js";

/** The verbs the native action backend can dispatch. */
export const STEP_VERBS = ["click", "type", "focus"] as const;
export type StepVerb = (typeof STEP_VERBS)[number];

export interface InteractStep {
  verb: StepVerb;
  /** ARIA role, exactly as the tree prints it. */
  role: string;
  /** Accessible name. `undefined` matches any name; `""` only unlabeled. */
  name?: string;
  /** 1-based pick among role+name matches, document order. */
  nth?: number;
  /** `type` only — the text to enter. Never echoed back in any output. */
  text?: string;
}

function isStepVerb(value: string): value is StepVerb {
  return (STEP_VERBS as readonly string[]).includes(value);
}

const USAGE = `usage: --step '<verb> <role> ["<name>"] [nth=<n>] [= <text>]' — verbs: ${STEP_VERBS.join(", ")}`;

function fail(message: string, hint = USAGE): never {
  throw new CliError(message, hint);
}

/**
 * Mask anything that could be a typed value before echoing step text back.
 *
 * Quoting the offending input is what makes these errors actionable — but a
 * malformed `type` step still carries its value, and the R1 discipline that
 * {@link describeStep} enforces on the success path has to hold on the failure
 * path too, or a typo turns a password into a CI log line.
 *
 * The parser can't know which token was *meant* to be the value once the step
 * is malformed, so this deliberately over-redacts: everything from the first
 * `=` onward goes, whether or not that `=` was the value separator. Masking a
 * name that happens to contain `=` costs a little precision in an error
 * message; the opposite mistake leaks a secret.
 */
function redactValue(text: string): string {
  const eq = text.indexOf("=");
  return eq === -1 ? text : `${text.slice(0, eq + 1)} ‹hidden›`;
}

/**
 * Read a double-quoted accessible name starting at `input[start]`, honoring
 * `\"` escapes. Returns the value and the index just past the closing quote.
 */
function readQuoted(
  input: string,
  start: number,
): { value: string; end: number } {
  let value = "";
  let i = start + 1; // skip the opening quote
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      value += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return { value, end: i + 1 };
    value += ch;
    i += 1;
  }
  return fail(
    `unterminated quoted name in step: ${JSON.stringify(redactValue(input))}`,
    "quote the accessible name on both sides, e.g. --step 'click button \"Save\"'",
  );
}

/** Parse one `--step` string into a validated {@link InteractStep}. */
export function parseStep(raw: string): InteractStep {
  const input = raw.trim();
  if (input === "") fail("empty --step");

  // ── verb ────────────────────────────────────────────────────────────────
  const verbMatch = /^([A-Za-z]+)(\s+|$)/.exec(input);
  if (!verbMatch)
    fail(
      `could not read a verb from step: ${JSON.stringify(redactValue(raw))}`,
    );
  const verb = verbMatch[1].toLowerCase();
  if (!isStepVerb(verb)) {
    fail(
      `unknown step verb "${verbMatch[1]}" — expected ${STEP_VERBS.join(", ")}`,
    );
  }
  let rest = input.slice(verbMatch[0].length).trimStart();

  // ── role ────────────────────────────────────────────────────────────────
  const roleMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(rest);
  if (!roleMatch) {
    fail(
      `step "${verb}" is missing a role — e.g. ${verb} button "Save"`,
      "roles are what the tree prints: button, link, textbox, checkbox, …",
    );
  }
  const role = roleMatch[1];
  rest = rest.slice(roleMatch[0].length).trimStart();

  // ── optional "name" ─────────────────────────────────────────────────────
  let name: string | undefined;
  if (rest.startsWith('"')) {
    const quoted = readQuoted(rest, 0);
    name = quoted.value;
    rest = rest.slice(quoted.end).trimStart();
  }

  // ── optional nth= ───────────────────────────────────────────────────────
  let nth: number | undefined;
  const nthMatch = /^nth=(\S*)/.exec(rest);
  if (nthMatch) {
    if (!/^[0-9]+$/.test(nthMatch[1]) || Number(nthMatch[1]) < 1) {
      fail(
        `nth must be a positive whole number (1-based) — got "${nthMatch[1]}"`,
      );
    }
    nth = Number(nthMatch[1]);
    rest = rest.slice(nthMatch[0].length).trimStart();
  }

  // ── optional "= text" ───────────────────────────────────────────────────
  let text: string | undefined;
  if (rest.startsWith("=")) {
    // Everything after the first `=` is the literal value, so a typed string
    // may itself contain `=` (query strings, base64) without escaping.
    text = rest.slice(1).trimStart();
    rest = "";
  }

  if (rest !== "") {
    fail(
      `unexpected trailing input in step: ${JSON.stringify(redactValue(rest))}`,
      "a name must be quoted — e.g. --step 'click button \"Save & continue\"'",
    );
  }

  if (verb === "type") {
    if (text === undefined) {
      fail(
        `step "type" needs a value — e.g. type textbox "Email" = someone@example.com`,
      );
    }
    if (text === "") {
      fail(
        `step "type" was given an empty value`,
        "to clear a field, pass a value; there is no clear verb yet",
      );
    }
  } else if (text !== undefined) {
    fail(
      `step "${verb}" takes no "= value" — only type does`,
      `did you mean: type ${role}${name === undefined ? "" : ` "${name}"`} = …`,
    );
  }

  return {
    verb,
    role,
    ...(name === undefined ? {} : { name }),
    ...(nth === undefined ? {} : { nth }),
    ...(text === undefined ? {} : { text }),
  };
}

/**
 * Describe a step for progress/report output.
 *
 * R1: a typed value is NEVER rendered. The CLI operator knows what they typed;
 * the report may be redirected to a file, pasted into an issue, or captured in
 * CI logs, and a password belongs in none of those.
 */
export function describeStep(step: InteractStep): string {
  const name = step.name === undefined ? "" : ` "${step.name}"`;
  const nth = step.nth === undefined ? "" : ` nth=${step.nth}`;
  const value = step.verb === "type" ? " = ‹hidden›" : "";
  return `${step.verb} ${step.role}${name}${nth}${value}`;
}
