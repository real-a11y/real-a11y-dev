/**
 * The checkpoint tools: findings checkpoints (axis B), their export / import,
 * and the tree checkpoint behind `diff_tree` (axis A).
 *
 * Moved out of `server.ts` unchanged; they reach the server's per-instance
 * state only through {@link CheckpointToolContext}.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { A11yRule } from "@real-a11y-dev/audit";
import {
  captureNativeCheckpoint,
  diffNativeCheckpoint,
} from "@real-a11y-dev/browser";
import {
  assertFullArtifact,
  buildArtifact,
  buildSnapshotPage,
  carriesValues,
  parseSnapshotArtifact,
  projectNativeTree,
  redactUrl,
  serializeArtifact,
  SnapshotFormatError,
  viewsOfPage,
} from "@real-a11y-dev/snapshot";
import { z } from "zod";

import {
  type CheckpointStore,
  differentUrl,
  diffCheckpointPages,
  diffLabeledCheckpoints,
  renderDiff,
  scopeMismatch,
} from "./checkpoints.js";
import type { SessionRecord } from "./sessions.js";
import {
  errText,
  MAX_OUTPUT_CHARS,
  READ_ONLY,
  RULES_HINT,
  text,
} from "./tool-output.js";

/** What the checkpoint tools borrow from `buildServer`'s closure. */
export interface CheckpointToolContext {
  server: McpServer;
  /** The `rules` enum source, built from the audit package's rule list. */
  rules: [A11yRule, ...A11yRule[]];
  /** This package's version, stamped into exported artifacts. */
  version: string;
  redactInput: boolean;
  liveValues: boolean;
  sessionParam: z.ZodDefault<z.ZodString>;
  withSession: <R>(
    name: string,
    fn: (rec: SessionRecord) => Promise<R>,
  ) => Promise<R | ReturnType<typeof errText>>;
  withCheckpoints: <R>(
    name: string,
    fn: (checkpoints: CheckpointStore) => Promise<R> | R,
  ) => Promise<R | ReturnType<typeof errText>>;
  readTree: (
    rec: SessionRecord,
  ) => ReturnType<SessionRecord["session"]["nativeTree"]>;
  pageUrl: (rec: SessionRecord) => string;
}

type CheckpointSchemas = {
  checkpointName: z.ZodString;
  checkpointValues: z.ZodDefault<z.ZodBoolean>;
};

function checkpointSchemas(redactInput: boolean): CheckpointSchemas {
  const checkpointName = z
    .string()
    .min(1)
    .max(64)
    .describe("Checkpoint label — the in-memory store key.");
  // Persisted outputs leave field values out unless asked (ADR-0001): a
  // checkpoint is exported as an artifact that gets committed and posted.
  const checkpointValues = z
    .boolean()
    .default(false)
    .describe(
      redactInput
        ? "Ignored: this server runs in strict mode (REAL_A11Y_REDACT_INPUT=1), so no field value is ever captured."
        : 'Capture each field\'s value in the checkpoint\'s tree view (`textbox "Email" = "jane@x.com"`, sensitive fields "[redacted]"). Default false — a checkpoint becomes an artifact that may be exported, committed and posted, so what users typed stays out unless you ask. A checkpoint captured with values can only be exported with values: true.',
    );
  return { checkpointName, checkpointValues };
}

function registerSaveFindings(
  ctx: CheckpointToolContext,
  { checkpointName, checkpointValues }: CheckpointSchemas,
): void {
  const {
    server,
    rules,
    redactInput,
    sessionParam,
    withSession,
    readTree,
    pageUrl,
  } = ctx;
  server.registerTool(
    "checkpoint_findings",
    {
      title: "Save a11y checkpoint",
      description:
        "Snapshot the CURRENT page's accessibility findings and store them under `name`. Later call diff_findings to see which findings are new / changed / fixed — the same identity semantics (fingerprints) the CI a11y-diff uses. Checkpoints survive navigation AND the session idle timeout (the browser may close and relaunch between saving and diffing; checkpoints remain), so you can checkpoint one deploy and diff another: save 'prod', open the preview URL, then diff_findings('prod'). They are held in memory and do NOT survive close_browser — call export_checkpoint first if you need one to outlive the session. The stored tree view leaves field values out unless you pass values: true. Whole-document. Chromium only.",
      inputSchema: {
        name: checkpointName,
        rules: z
          .array(z.enum(rules))
          .optional()
          .describe("Subset of rules for the findings. Omit to run all."),
        values: checkpointValues,
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, rules, values, session }) =>
      withSession(session, async (rec) => {
        // Native, like `real-a11y snapshot`. These two write the SAME artifact
        // shape through the same assembler so a checkpoint captured by one can be
        // diffed by the other — which only holds while both read the same
        // producer. `tabOrder: false` is the other half: a native page omits the
        // tabs view rather than storing an empty one.
        const captureValues = values === true && !redactInput;
        const snap = projectNativeTree(await readTree(rec), {
          rules,
          values: captureValues,
        });
        const page = buildSnapshotPage(name, pageUrl(rec), snap, {
          root: "body",
          tabOrder: false,
        });
        rec.checkpoints.save(name, {
          page,
          rules,
          ...(captureValues ? { values: true } : {}),
        });
        const treeKb = (page.tree.length / 1024).toFixed(1);
        return text(
          `"${name}" saved: ${page.findings.length} finding(s) (tree ${treeKb} KB). ${rec.checkpoints.size} checkpoint(s) stored.`,
        );
      }),
  );
}

function registerDiffFindings(
  ctx: CheckpointToolContext,
  { checkpointName }: CheckpointSchemas,
): void {
  const { server, redactInput, sessionParam, withSession, readTree, pageUrl } =
    ctx;

  server.registerTool(
    "diff_findings",
    {
      title: "Diff current page vs a checkpoint",
      annotations: READ_ONLY,
      description:
        "Re-snapshot the CURRENT page and diff it against the stored checkpoint `name`: which accessibility findings are NEW (these gate CI), CHANGED, or FIXED, plus an advisory structural summary. Use after a change (deploy, feature toggle, DOM edit) or after navigating to a different deploy of the same page.",
      inputSchema: { name: checkpointName, session: sessionParam },
    },
    async ({ name, session }) =>
      withSession(session, async (rec) => {
        const base = rec.checkpoints.get(name);
        if (!base) {
          return errText(
            `No checkpoint named "${name}". Save one first with checkpoint_findings.`,
          );
        }
        // Re-snapshot with the SAME rule set the checkpoint was captured with, so
        // findings from rules the base never ran don't read as spurious NEW.
        const snap = projectNativeTree(await readTree(rec), {
          // Stored loosely as `string[]`; validated against the rule enum when
          // the checkpoint was saved.
          rules: base.rules as A11yRule[] | undefined,
          // …and with values iff the base has them, or every filled field
          // would read as a changed tree line.
          values: base.values === true && !redactInput,
        });
        const head = buildSnapshotPage(name, pageUrl(rec), snap, {
          root: "body",
          tabOrder: false,
        });
        // An imported base may have been captured at a narrow root; this side is
        // always whole-document. Say so — silently widening turns everything
        // outside the old subtree into NEW findings, the class that gates CI.
        const scopeNote = scopeMismatch(base.page, head);
        // A checkpoint captured (or imported) with values, diffed on a server
        // running with REAL_A11Y_REDACT_INPUT: this side can carry none, so
        // every filled field reads as a changed tree line. Say so rather than
        // let it pass for a regression — the same warning the CLI's `diff`
        // gives a one-sided pair. Findings carry no values and are unaffected.
        const valuesNote =
          base.values === true && redactInput
            ? `Note: checkpoint "${name}" carries field values, but this server runs with REAL_A11Y_REDACT_INPUT, so the current tree has none — every filled field reads as a changed tree line. Findings are unaffected.`
            : undefined;
        const note = [scopeNote, valuesNote].filter(Boolean).join("\n\n");
        // Checkpoints survive navigation by design, so the agent may well have
        // moved to another page between saving and diffing.
        const body = renderDiff(diffCheckpointPages(base.page, head), {
          source: { kind: "live", checkpoint: name },
          differentUrl: differentUrl(base.page, head),
        });
        return text(note ? `${note}\n\n${body}` : body, RULES_HINT);
      }),
  );
}

function registerCheckpointDiffs(
  ctx: CheckpointToolContext,
  { checkpointName }: CheckpointSchemas,
): void {
  const { server, sessionParam, withCheckpoints } = ctx;
  server.registerTool(
    "diff_checkpoints",
    {
      title: "Diff two stored checkpoints",
      annotations: READ_ONLY,
      description:
        "Diff two already-stored checkpoints against each other (no re-snapshot): which findings are new / changed / fixed going from `base` to `head`.",
      inputSchema: {
        base: checkpointName,
        head: checkpointName,
        session: sessionParam,
      },
    },
    async ({ base, head, session }) =>
      withCheckpoints(session, (checkpoints) => {
        const b = checkpoints.get(base);
        if (!b) return errText(`No checkpoint named "${base}".`);
        const h = checkpoints.get(head);
        if (!h) return errText(`No checkpoint named "${head}".`);
        // Two stored checkpoints can disagree on scope just as easily — either
        // side may have been imported from a scoped, DOM-era artifact.
        const note = scopeMismatch(b.page, h.page);
        const rendered = renderDiff(diffLabeledCheckpoints(b.page, h.page), {
          source: { kind: "stored", base, head },
          differentUrl: differentUrl(b.page, h.page),
        });
        return text(note ? `${note}\n\n${rendered}` : rendered, RULES_HINT);
      }),
  );

  server.registerTool(
    "list_checkpoints",
    {
      title: "List checkpoints",
      annotations: READ_ONLY,
      description:
        "List the stored checkpoint labels with their finding counts and approximate tree sizes.",
      inputSchema: { session: sessionParam },
    },
    async ({ session }) =>
      withCheckpoints(session, (checkpoints) => {
        if (checkpoints.size === 0) {
          return text("No checkpoints saved. Use checkpoint_findings first.");
        }
        const lines = checkpoints
          .entries()
          .map(
            ([name, cp]) =>
              `  ${name}: ${cp.page.findings.length} finding(s), tree ${(cp.page.tree.length / 1024).toFixed(1)} KB${cp.values ? " (with field values)" : ""}`,
          );
        return text(`${checkpoints.size} checkpoint(s):\n${lines.join("\n")}`);
      }),
  );
}

function registerExportCheckpoint(
  ctx: CheckpointToolContext,
  { checkpointName }: CheckpointSchemas,
): void {
  const { server, version, sessionParam, withCheckpoints } = ctx;
  server.registerTool(
    "export_checkpoint",
    {
      title: "Export a checkpoint as JSON",
      annotations: READ_ONLY,
      description:
        "Return a stored checkpoint as a Real A11y snapshot artifact — the same a11y-snapshot.json the CLI writes (same schemaVersion, same fingerprints). Persist it to your own file to diff across sessions, or feed it to the CI a11y-diff. An artifact carries no field values unless the checkpoint was captured with values: true AND you export it with values: true. Checkpoints are whole-document, and the artifact has to come back as one valid JSON string, so a large page can exceed the output cap and fail — use the CLI's `real-a11y snapshot --output` for those.",
      inputSchema: {
        name: checkpointName,
        values: z
          .boolean()
          .default(false)
          .describe(
            "Export a checkpoint that was captured with field values. Default false, which refuses one rather than write what users typed into an artifact that may be committed and posted. A checkpoint captured without values exports the same either way.",
          ),
        session: sessionParam,
      },
    },
    async ({ name, values, session }) =>
      withCheckpoints(session, (checkpoints) => {
        const cp = checkpoints.get(name);
        if (!cp) return errText(`No checkpoint named "${name}".`);
        // A persisted output needs its own opt-in (ADR-0001): the capture's
        // `values: true` was for diffing in-session, not a decision to write
        // the values into a file. Refuse rather than strip, because a tree
        // view can't be un-valued after the fact.
        if (cp.values === true && values !== true) {
          return errText(
            `Checkpoint "${name}" was captured with field values, so its artifact would carry what users typed. Pass values: true to export it anyway, or re-capture it with checkpoint_findings (values: false) for an artifact without them.`,
          );
        }
        const artifact = buildArtifact([cp.page], {
          toolName: "@real-a11y-dev/mcp",
          toolVersion: version,
          // Declare what was measured, reading it off the PAGE rather than
          // assuming. A checkpoint captured here is native and has no tabs view —
          // but one loaded by import_checkpoint may be a DOM-era artifact that
          // does. Hardcoding "no tabs" would silently drop that page's tab data
          // on re-export; hardcoding "tabs" would tell the next reader every stop
          // vanished. The page is the only honest source.
          views: viewsOfPage(cp.page),
          ...(cp.rules ? { rules: cp.rules } : {}),
          ...(cp.values ? { values: true } : {}),
        });
        const json = serializeArtifact(artifact);
        // Never truncate a JSON artifact into invalid JSON — the outer bounded()
        // cap would corrupt it. Fail cleanly so the agent gets no artifact rather
        // than an unparseable one.
        //
        // What the failure SAYS is the harder half. Checkpoints are whole-document
        // now, so the old "re-save it with a narrower rootSelector" names a
        // parameter `checkpoint_findings` no longer has: an agent that follows it
        // gets a schema error, and one that doesn't has nothing left to try. The
        // levers that do exist are worth naming precisely — `rules` shrinks the
        // findings and NOT the tree, so it only helps when findings are the bulk,
        // which is why the sizes are broken out rather than summed. And the honest
        // answer for a genuinely large page is that this tool is the wrong one:
        // the CLI writes the identical artifact to a file, with no inline cap.
        if (json.length > MAX_OUTPUT_CHARS) {
          const kb = (n: number) => Math.round(n / 1024);
          return errText(
            `Checkpoint "${name}" is too large to export inline (${kb(json.length)} KB > ${kb(MAX_OUTPUT_CHARS)} KB cap; the tree alone is ${kb(cp.page.tree.length)} KB, ${cp.page.findings.length} finding(s)). ` +
              `Checkpoints are whole-document, so there is no scope to narrow — a \`rules\` subset shrinks the findings but never the tree. ` +
              `To compare it, diff in-session (diff_findings / diff_checkpoints need no export). ` +
              `To keep it, capture the page with the CLI instead: \`real-a11y snapshot <url> --output a11y-snapshot.json\` writes the same artifact to a file, uncapped.`,
          );
        }
        return text(json);
      }),
  );
}

function registerImportCheckpoint(
  ctx: CheckpointToolContext,
  { checkpointName }: CheckpointSchemas,
): void {
  const { server, sessionParam, withCheckpoints } = ctx;

  server.registerTool(
    "import_checkpoint",
    {
      title: "Import a checkpoint from JSON",
      description:
        "Load an externally-held Real A11y snapshot artifact (e.g. a CLI-generated baseline) into the store under `name`, so a live page can be diffed against it. Input is validated strictly; the artifact's first page is stored.",
      inputSchema: {
        name: checkpointName,
        artifact: z
          .string()
          .describe("A serialized Real A11y snapshot artifact (JSON)."),
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, artifact, session }) =>
      withCheckpoints(session, (checkpoints) => {
        try {
          const parsed = parseSnapshotArtifact(artifact);
          // Refuse a partial (`--only`) capture, exactly as `real-a11y diff` does:
          // an imported checkpoint becomes the diff BASE, and a filtered-away axis
          // would read as everything-new — reported as findings that "gate CI".
          assertFullArtifact(parsed, `artifact for "${name}"`);
          const src = parsed.pages[0];
          if (!src) return errText(`Artifact for "${name}" has no pages.`);
          // Stored exactly as it arrived. This used to rename the page to the
          // store label and re-fingerprint under it, because the label WAS the
          // identity and an artifact's own page name would never equal it — so
          // without the rewrite every finding read as both NEW and FIXED.
          //
          // Pages carry an `id` derived from their URL now, so the artifact
          // already agrees with a live re-snapshot of the same route, and
          // rewriting would break the very join it once repaired. The store key
          // and the page's own name are free to differ, which is what they are.
          checkpoints.save(name, {
            page: src,
            rules: parsed.meta?.rules ?? undefined,
            // Carried over so a diff re-snapshots the same way, and a
            // re-export keeps asking before it writes them out again.
            ...(carriesValues(parsed) ? { values: true } : {}),
          });
          const extra =
            parsed.pages.length > 1
              ? ` (first of ${parsed.pages.length} pages)`
              : "";
          return text(
            `Imported "${name}": ${src.findings.length} finding(s)${extra}. ${checkpoints.size} checkpoint(s) stored.`,
          );
        } catch (err) {
          const msg =
            err instanceof SnapshotFormatError
              ? err.message
              : "invalid artifact";
          return errText(`Could not import "${name}": ${msg}`);
        }
      }),
  );
}

function registerTreeCheckpoints(ctx: CheckpointToolContext): void {
  const {
    server,
    redactInput,
    liveValues,
    sessionParam,
    withSession,
    readTree,
    pageUrl,
  } = ctx;
  server.registerTool(
    "checkpoint_tree",
    {
      title: "Checkpoint the tree (for an interaction diff)",
      description:
        "Capture the CURRENT accessibility tree as a comparison point. Then interact — click, type, open a dialog — and call diff_tree to see exactly which nodes were added, removed, or changed, and where focus moved. Reads the whole document with the same native producer the act tools target, so the diff speaks one vocabulary. If a step navigates, diff_tree says the document was replaced rather than reporting the entire page as changed.",
      inputSchema: { session: sessionParam },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session }) =>
      withSession(session, async (rec) => {
        const tree = await readTree(rec);
        rec.treeCheckpoint = captureNativeCheckpoint(tree, pageUrl(rec));
        return text(
          `Tree checkpoint captured — ${tree.nodes.size} node(s). Interact, then call diff_tree.`,
        );
      }),
  );

  server.registerTool(
    "diff_tree",
    {
      title: "Diff the tree since the checkpoint",
      annotations: READ_ONLY,
      description:
        "Diff the CURRENT accessibility tree against the one captured by checkpoint_tree: nodes added, removed, or changed, plus a focus move. This is the interaction diff — the precise answer to 'what did that click actually change for a screen reader?'." +
        (redactInput
          ? " This server runs in strict mode (REAL_A11Y_REDACT_INPUT=1), so what a field holds never appears here."
          : ' After type_text it shows what the field now holds — `~ textbox "Email": a11y.value (unset) → "jane@x.com"`, a sensitive field as "[redacted]".'),
      inputSchema: { session: sessionParam },
    },
    async ({ session }) =>
      withSession(session, async (rec) => {
        const checkpoint = rec.treeCheckpoint;
        if (!checkpoint) {
          return errText(
            "No tree checkpoint in this session — call checkpoint_tree first, then interact, then diff_tree.",
          );
        }
        const outcome = diffNativeCheckpoint(
          checkpoint,
          await readTree(rec),
          pageUrl(rec),
          { values: liveValues },
        );
        // A navigation is a real outcome of a real click, not a failure. The
        // checkpoint itself survived — it lives here, not in the page — but the
        // node identity it was written in did not, so there is nothing left to
        // compare against. Saying so beats reporting the whole page added.
        if (outcome.kind === "replaced") {
          // The checkpoint is NOT consumed here. `diff_tree` is annotated
          // read-only and idempotent, and a client that retries it — after a
          // transport hiccup, or simply twice — must get the same answer
          // rather than "call checkpoint_tree first", which would drop the
          // one piece of information the retry was after.
          //
          // That obliges wording that stays true on the second call as much as
          // the first: the checkpoint's own address never moves, and "the page
          // is now" is read fresh each time, so a further navigation reads as
          // the new address rather than as a second event being announced.
          //
          // Redact like every other URL this server prints. A click can land
          // on a one-time token or a userinfo URL, and this string goes
          // straight into an agent's context.
          return text(
            `The page navigated (or reloaded), so the checkpoint describes a document that no longer exists — no diff available.\n` +
              `Checkpoint captured on: ${redactUrl(outcome.from)}\n` +
              `The page is now: ${redactUrl(outcome.to)}\n` +
              `Call checkpoint_tree again to start a new comparison.`,
          );
        }
        return text(
          outcome.changed
            ? outcome.rendered
            : "No tree changes since the checkpoint.",
        );
      }),
  );
}

/** Register every checkpoint tool on the server. */
export function registerCheckpointTools(ctx: CheckpointToolContext): void {
  const schemas = checkpointSchemas(ctx.redactInput);
  registerSaveFindings(ctx, schemas);
  registerDiffFindings(ctx, schemas);
  registerCheckpointDiffs(ctx, schemas);
  registerExportCheckpoint(ctx, schemas);
  registerImportCheckpoint(ctx, schemas);
  registerTreeCheckpoints(ctx);
}
