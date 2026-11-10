/**
 * Prose and error mapping for `buildServer`, moved out of it unchanged so the
 * server file holds registration only. Everything here is a pure function of
 * its arguments — no module-scope state.
 */
import { isPlaywrightMissing } from "@real-a11y-dev/browser";
import { SessionRegistryError } from "@real-a11y-dev/session-registry";
import { redactUrlsIn, sanitizeText } from "@real-a11y-dev/snapshot";

import { errText, PLAYWRIGHT_MISSING_HINT } from "./tool-output.js";

export interface ServerNotes {
  valuesNote: string;
  browserMode: string;
  authNote: string;
}

/** The mode-dependent sentences woven into tool descriptions and results. */
export function serverNotes(flags: {
  redactInput: boolean;
  cdpAttached: boolean;
  headful: boolean;
  authenticated: boolean;
}): ServerNotes {
  const { redactInput, cdpAttached, headful, authenticated } = flags;
  const valuesNote = redactInput
    ? " This server runs in strict mode (REAL_A11Y_REDACT_INPUT=1): no field value and no rich-text editor content appears in any result."
    : ' Each field shows what it holds, the way a screen reader announces it — `textbox "Email" = "jane@x.com"`; a password, one-time-code or payment field reads "[redacted]".';
  // Over CDP the window state belongs to the browser we attached to, and
  // REAL_A11Y_MCP_HEADFUL is inert — never offer it as a fix there.
  const browserMode = cdpAttached
    ? "attached to your running Chrome (its own window state; REAL_A11Y_MCP_HEADFUL has no effect over CDP)"
    : headful
      ? "headful (a window is open)"
      : "headless (no window — set REAL_A11Y_MCP_HEADFUL=1 to see one)";
  // Three auth states, not two. A CDP attach never carries a storage state
  // (they're mutually exclusive), but `ensurePage` reuses the attached
  // browser's own context — so its pages inherit whatever that profile is
  // signed into. "NO saved login, expect a logged-out view" is wrong there,
  // and "restart with REAL_A11Y_MCP_CDP" prescribes the setup already in use.
  // It's still not a promise of auth: that browser may be signed into nothing,
  // and only the human at that window can change it.
  const authNote = authenticated
    ? " This server was started with a saved login session, so pages open ALREADY AUTHENTICATED — do not try to log in or navigate to a login page; open the destination directly."
    : cdpAttached
      ? " This server is attached to a Chrome the user is already running, so pages open with whatever sessions THAT browser holds — a page behind auth may well open already authenticated; check what you actually got rather than assuming either way. Don't try to log in through the tools — there is no credential parameter, deliberately. If a page does come up logged out, the user has to sign in in that Chrome window; the server cannot do it for them, and no environment variable changes it."
      : " This server has NO saved login, so a page behind auth will open as a logged-out view. Don't try to log in through the tools — there is no credential parameter, deliberately. Tell the user to restart the server with REAL_A11Y_MCP_STORAGE_STATE (a saved session from `real-a11y login`) or REAL_A11Y_MCP_CDP (attach to a Chrome they're already signed into).";
  return { valuesNote, browserMode, authNote };
}

/** The server-level `instructions` string shown to the client. */
export function serverInstructions(multiSession: boolean): string {
  return (
    "Audit any web page's accessibility for AI agents. Call open_page(url) FIRST, then use audit_page (violations), inspect_page (findings + tree + outline + tab order from one consistent snapshot — prefer on dynamic pages), or the get_* / list_elements views. To interact: checkpoint_tree, then click_element / type_text / focus_element (target by role + accessible name), then diff_tree to see exactly what changed. " +
    (multiSession
      ? "Every page tool takes an optional `session` — separate names are independent live pages with their own checkpoints; calls within one session are serialized automatically, and different sessions may run in parallel. Omit `session` to keep using the one default page."
      : 'This server manages a SINGLE browser session — always omit the `session` parameter (or pass "default"); other names are refused.')
  );
}

/** Map a session-level failure to a tool error, or rethrow it sanitized. */
export function sessionErrText(err: unknown) {
  if (err instanceof SessionRegistryError) {
    return errText(err.hint ? `${err.message} — ${err.hint}` : err.message);
  }
  // Non-Error throws reach the SDK's `String(error)` fallback raw, so they
  // need the same treatment as an Error's message.
  if (!(err instanceof Error)) {
    throw new Error(
      redactUrlsIn(sanitizeText(String(err), { singleLine: true })),
    );
  }
  // An install problem the user can fix, so a tool error with the remedy.
  if (isPlaywrightMissing(err)) {
    return errText(`${err.message} — ${PLAYWRIGHT_MISSING_HINT}`);
  }
  // Anything else escapes as a protocol error, and the SDK relays its message
  // to the client verbatim. Playwright quotes the full target URL in a
  // navigation failure — `page.goto: net::ERR_ABORTED at https://…#token=…` —
  // so a failed open leaks what a successful one now redacts. The CLI already
  // guards its equivalent path with `redactUrlsIn`; this is the MCP side of
  // the same boundary. The message is rewritten in place so the error keeps
  // its class and stack.
  err.message = sanitizeText(redactUrlsIn(err.message), { singleLine: true });
  throw err;
}
