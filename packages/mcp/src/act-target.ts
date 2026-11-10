/**
 * Act-tool target resolution and refusals: the pure half of
 * `click_element` / `type_text` / `focus_element`. Reading the tree stays in
 * the server (strict mode is its concern); everything here is a function of
 * the tree it is handed.
 */

import { resolveTarget } from "@real-a11y-dev/browser";
import type { TargetCandidate } from "@real-a11y-dev/browser";

import { errText } from "./tool-output.js";

export const describeTarget = (c: TargetCandidate) => `${c.role} "${c.name}"`;
const MAX_CANDIDATES = 10;

export function resolveActTarget(
  tree: Parameters<typeof resolveTarget>[0],
  role: string,
  name: string | undefined,
  nth: number | undefined,
):
  | { ok: true; nodeId: string; candidate: TargetCandidate }
  | { ok: false; res: ReturnType<typeof errText> } {
  const resolved = resolveTarget(tree, { role, name, nth });
  switch (resolved.kind) {
    case "resolved":
      return {
        ok: true,
        nodeId: resolved.nodeId,
        candidate: resolved.candidate,
      };
    case "not-found": {
      const label = name !== undefined ? `${role} named "${name}"` : role;
      if (resolved.matchesForRole > 0) {
        return {
          ok: false,
          res: errText(
            `No ${label} in the accessibility tree — but ${resolved.matchesForRole} ${role}(s) with other ` +
              `names exist. Check the name with get_semantic_tree, or omit name to list the candidates.`,
          ),
        };
      }
      return {
        ok: false,
        res: errText(
          `No ${label} in the accessibility tree. Re-read it with get_semantic_tree — ` +
            `the page may have changed, or the element may not be exposed to assistive tech at all ` +
            `(which is itself an accessibility finding).`,
        ),
      };
    }
    case "ambiguous": {
      const shown = resolved.candidates.slice(0, MAX_CANDIDATES);
      const lines = shown.map(
        (c) =>
          `  nth=${c.nth} · ${describeTarget(c)}${c.disabled ? " (disabled)" : ""}`,
      );
      const more = resolved.candidates.length - shown.length;
      if (more > 0) lines.push(`  … +${more} more`);
      return {
        ok: false,
        res: errText(
          `${resolved.candidates.length} ${role}(s) match — pass nth (1-based, document order) to pick one:\n` +
            lines.join("\n"),
        ),
      };
    }
    case "nth-out-of-range":
      return {
        ok: false,
        res: errText(
          `nth=${resolved.nth}, but only ${resolved.matchCount} node(s) match.`,
        ),
      };
    case "no-dom-node":
      return {
        ok: false,
        res: errText(
          `Matched ${describeTarget(resolved.candidate)}, but it has no backing DOM element ` +
            `(a synthesized node) — it can't be acted on.`,
        ),
      };
  }
}

// A disabled control swallows the action silently — el.click() "succeeds"
// and fires nothing, so the agent would see success plus an empty diff and
// draw the wrong conclusion. Refuse with the cause instead.
export function disabledRefusal(candidate: TargetCandidate, verb: string) {
  return errText(
    `${describeTarget(candidate)} is disabled — the page would ignore the ${verb}. ` +
      `If enabling it is the point of the flow, act on whatever enables it first ` +
      `(diff_tree after that action will show the state change).`,
  );
}

// A resolved target that is disabled becomes the shared refusal, so every act
// tool turns "resolved" into "resolved and enabled" the same way. `verb` names
// what the page would have ignored ("click" | "input" | "focus").
export function refuseIfDisabled(
  target: ReturnType<typeof resolveActTarget>,
  verb: string,
): ReturnType<typeof resolveActTarget> {
  if (target.ok && target.candidate.disabled) {
    return { ok: false, res: disabledRefusal(target.candidate, verb) };
  }
  return target;
}

export function actFailure(toolName: string, error: string | undefined) {
  // The backend's "re-read the tree and retry" remedy presumes a caller
  // holding node ids. Here the target resolved from a fresh tree
  // microseconds ago, so a resolution miss means the page mutated mid-action
  // — and the re-read IS a retry of this tool.
  if (error !== undefined && /could not resolve node/.test(error)) {
    return errText(
      `The target changed or disappeared mid-action — the page mutated. Retry ${toolName}.`,
    );
  }
  return errText(error ?? "the action failed");
}
