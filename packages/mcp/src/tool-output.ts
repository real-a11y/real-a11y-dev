/**
 * Shared tool-output plumbing for the MCP server: the output cap, the
 * sanitized error shape, the hint strings and the zod fragments every tool
 * registration reuses. Pure module-level values — no per-server state.
 */

import { redactUrlsIn, sanitizeText } from "@real-a11y-dev/snapshot";
import { z } from "zod";

/**
 * A CSS scope for the in-page walk.
 *
 * Only `get_tab_order` still takes it: tab SEQUENCE is layout work Chromium's
 * AX tree doesn't expose, so that one view is still an in-page walk. Everything
 * else — the tree checkpoints included, as of the native migration — reads
 * Chromium's own accessibility tree, which is whole-document: there is nothing
 * for a selector to scope, and a parameter that silently did nothing would be
 * worse than none at all.
 */
export const rootSelector = z
  .string()
  .default("body")
  .describe("CSS selector for the extraction root. Defaults to 'body'.");

/**
 * Cap oversized tool output so a huge page can't blow the agent's context.
 *
 * The hint carries as much weight as the cap. Every truncation used to end
 * "narrow with rootSelector" — a parameter four of the five read tools no
 * longer accept, so the advice arrives attached to the one output where the
 * agent most needs a way forward and names a door that isn't there. Each caller
 * passes the lever IT actually has instead, and a tool with none passes nothing:
 * "this is the whole document" is a worse answer than a fix, and a better one
 * than a fix that doesn't exist.
 */
export const MAX_OUTPUT_CHARS = 40_000;
export function bounded(body: string, hint?: string): string {
  if (body.length <= MAX_OUTPUT_CHARS) return body;
  return (
    body.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n… output truncated at ${MAX_OUTPUT_CHARS} chars.${hint ? ` ${hint}` : ""}`
  );
}

/**
 * A page-supplied title, made safe to print. Sanitized because `document.title`
 * is page-controlled — an escape sequence or a newline in it could forge result
 * lines — and capped because it is unbounded: a multi-megabyte title would
 * flood the agent's context on every open_page.
 */
export const TITLE_CAP = 300;
export function pageTitle(raw: string): string {
  const clean = sanitizeText(raw, { singleLine: true }).slice(0, TITLE_CAP);
  return clean || "(untitled)";
}

export function text(body: string, hint?: string) {
  return { content: [{ type: "text" as const, text: bounded(body, hint) }] };
}

/**
 * Playwright is a peer of this package. npm installs it with the server, under
 * npx too, and so does pnpm with its default `auto-install-peers`. Yarn, pnpm
 * with that setting off, and a `--legacy-peer-deps` install leave it out. The
 * module error alone names no fix, so a tool that needs a browser answers with
 * one.
 */
export const PLAYWRIGHT_MISSING_HINT =
  "Playwright isn't installed beside the server. Launch it as `npx -y -p @real-a11y-dev/mcp -p playwright real-a11y-mcp`, or install `playwright` next to `@real-a11y-dev/mcp` in the project the client starts it from.";

// The three levers that survive the migration, named once so a tool can't
// advertise one it doesn't take.
/** The one tool still built on the in-page walk: `get_tab_order`. */
export const SCOPE_HINT = "Pass a narrower `rootSelector` to scope the walk.";
/** Anything whose bulk is findings. Narrows the findings, never the tree. */
export const RULES_HINT = "Pass a `rules` subset to report fewer findings.";
/** The whole-document reads, which have no scope parameter at all. */
export const SLICE_HINT =
  "This read is whole-document and takes no `rootSelector` — `get_heading_outline` and `list_elements` return smaller slices of the same tree.";

// ── Act-tool targeting fragments ─────────────────────────────────────────
// Targets are described in the tree's own vocabulary — role + accessible
// name — never a node id. Ids are internal and realm-bound; resolution runs
// against a fresh native tree immediately before each dispatch.
export const actRole = z
  .string()
  .min(1)
  .describe(
    "ARIA role of the target, exactly as the tree prints it — e.g. 'button', " +
      "'link', 'textbox', 'checkbox', 'menuitem'.",
  );
export const actName = z
  .string()
  .optional()
  .describe(
    "Accessible name of the target — case-insensitive, whitespace-normalized " +
      "EXACT match against the tree get_semantic_tree returns. Pass '' to " +
      "target an unlabeled control. Omit to match any name; if several nodes " +
      "match, the error lists them so you can pass nth.",
  );
export const actNth = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    "1-based pick among the matching nodes in document order, evaluated among " +
      "the role+name-filtered matches. Use after an ambiguity error lists the " +
      "candidates.",
  );

/** Hints for the read-only query tools (no side effects, closed world). */
export const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Every client-visible error goes through here, so the boundary lives here
// rather than at each thrower: `import_checkpoint` and the session refusals
// build through it too, and a redaction that only guards the paths someone
// remembered is the shape this PR keeps finding.
export const errText = (msg: string) => ({
  content: [
    {
      type: "text" as const,
      text: bounded(sanitizeText(redactUrlsIn(msg), { singleLine: true })),
    },
  ],
  isError: true as const,
});
