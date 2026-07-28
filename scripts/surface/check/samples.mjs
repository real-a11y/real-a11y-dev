// Run every `real-a11y …` line in the docs through the real argument parser.
//
// The repo's own rule for writing docs is that a wrong name is copy-paste-
// broken code. This is that rule, enforced: each shell sample is tokenized and
// handed to `node:util.parseArgs` with the exact `options` the command ships,
// so a flag that was renamed, removed, or never existed fails the build instead
// of failing in a reader's terminal.
//
// What it does NOT do is check semantics. `--device "iPhone 99"` parses fine and
// is not this check's business; neither is whether a URL resolves. The claim is
// narrow and total: every documented invocation is one the CLI would accept.

import { parseArgs } from "node:util";

import { docFiles, fencedBlocks, headings, readDoc } from "./markdown.mjs";

const SHELL_LANGS = new Set(["sh", "bash", "shell", "console", "zsh"]);

/** Ways the docs spell "run the CLI". */
const INVOCATIONS = [
  /^real-a11y$/,
  /^npx$/, // npx real-a11y …
  /^pnpm$/, // pnpm real-a11y … / pnpm exec real-a11y …
  /^node$/, // node packages/cli/dist/index.js …
];

/**
 * Split a shell line into words the way a shell would: quotes group, a
 * backslash escapes the next character, and everything else splits on
 * whitespace.
 *
 * Returns null for a line that doesn't tokenize (an unbalanced quote), which
 * is itself worth reporting — a sample nobody can paste.
 */
export function tokenize(line) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length)
        current += line[++i];
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return null;
  if (started || current) tokens.push(current);
  return tokens;
}

/**
 * Join continuation lines, drop comments, and split a block into the individual
 * commands a shell would run.
 *
 * Comment stripping is quote-aware: `--name "# 1"` is an accessible name, not
 * the start of a comment, and the act examples really do contain one.
 */
function commandLines(blockLines) {
  const joined = [];
  let pending = null;

  for (const { text, line } of blockLines) {
    const trimmed = text.trim();
    const body = pending ? `${pending.text} ${trimmed}` : trimmed;
    const startLine = pending ? pending.line : line;

    if (body.endsWith("\\")) {
      pending = { text: body.slice(0, -1).trim(), line: startLine };
      continue;
    }
    pending = null;
    if (body) joined.push({ text: body, line: startLine });
  }
  if (pending) joined.push(pending);

  const commands = [];
  for (const { text, line } of joined) {
    // Strip an interactive prompt, then a trailing comment.
    let body = text.replace(/^[$#]\s+/, "");
    let quote = null;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "#" && (i === 0 || /\s/.test(body[i - 1]))) {
        body = body.slice(0, i);
        break;
      }
    }
    // Pipelines, lists, and command substitution each contain a command.
    for (const part of splitOperators(body)) {
      const segment = part.trim();
      if (segment) commands.push({ text: segment, line });
    }
  }
  return commands;
}

/** Split on `|`, `&&`, `||`, `;` and unwrap `$(…)` / backticks. */
function splitOperators(body) {
  const out = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "$" && body[i + 1] === "(") {
      const close = body.indexOf(")", i);
      if (close !== -1) {
        out.push(...splitOperators(body.slice(i + 2, close)));
        i = close;
        continue;
      }
    }
    if (ch === "|" || ch === "&" || ch === ";") {
      out.push(current);
      current = "";
      if (body[i + 1] === ch) i++; // && / ||
      continue;
    }
    current += ch;
  }
  out.push(current);
  // A redirect is not another command, just noise on this one.
  return out.map((part) => part.replace(/\s*[12]?>>?\s*\S+/g, ""));
}

/** Drop `VAR=value` prefixes; they configure the command, they aren't argv. */
function stripEnvPrefix(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[i])) i++;
  return tokens.slice(i);
}

/**
 * The argv the CLI itself would see, or null when this isn't a CLI invocation.
 */
function cliArgv(tokens) {
  const argv = stripEnvPrefix(tokens);
  if (argv.length === 0) return null;
  if (!INVOCATIONS.some((re) => re.test(argv[0]))) return null;

  if (argv[0] === "real-a11y") return argv.slice(1);
  if (argv[0] === "npx") {
    const rest = argv.slice(1).filter((t) => t !== "-y" && t !== "--yes");
    return rest[0] === "real-a11y" || rest[0]?.endsWith("/cli")
      ? rest.slice(1)
      : null;
  }
  if (argv[0] === "pnpm") {
    const rest = argv.slice(1).filter((t) => t !== "exec" && t !== "dlx");
    return rest[0] === "real-a11y" ? rest.slice(1) : null;
  }
  if (argv[0] === "node") {
    return /cli\/dist\/index\.js$/.test(argv[1] ?? "") ? argv.slice(2) : null;
  }
  return null;
}

/** A `<placeholder>` or `…` stands in for a real value — nothing to validate. */
function isPlaceholder(token) {
  return /^<.*>$/.test(token) || token === "…" || token === "...";
}

/** parseArgs `options`, rebuilt from the manifest's record of the flag. */
function optionsFor(command) {
  return Object.fromEntries(
    command.flags.map((flag) => [
      flag.name,
      {
        type: flag.type,
        ...(flag.short ? { short: flag.short } : {}),
        ...(flag.multiple ? { multiple: true } : {}),
      },
    ]),
  );
}

/**
 * @returns `{ problems, checked }` — `checked` is how many invocations actually
 * reached the parser. It is reported rather than kept internal because the
 * dangerous failure of a check like this is not a false alarm, it is silence:
 * a tokenizer that stops recognising the samples passes everything forever. The
 * caller treats zero as a failure.
 */
export async function checkSamples(repoRoot, manifest) {
  const problems = [];
  let checked = 0;
  const byName = new Map(manifest.cli.commands.map((c) => [c.name, c]));

  for (const file of await docFiles(repoRoot)) {
    const text = await readDoc(repoRoot, file);
    for (const block of fencedBlocks(text)) {
      if (!SHELL_LANGS.has(block.lang)) continue;

      for (const { text: line, line: lineNo } of commandLines(block.lines)) {
        const tokens = tokenize(line);
        const where = `${file}:${lineNo}`;
        if (tokens === null) {
          // Only report if it looked like ours; an unbalanced quote in some
          // unrelated snippet is not this check's business.
          if (line.includes("real-a11y")) {
            problems.push({
              where,
              message: `has an unbalanced quote and can't be pasted: ${line}`,
            });
          }
          continue;
        }

        const argv = cliArgv(tokens);
        if (argv === null || argv.length === 0) continue;
        // `real-a11y --help` / `--version` resolve before command lookup.
        if (argv[0].startsWith("-")) continue;
        if (isPlaceholder(argv[0])) continue;

        const command = byName.get(argv[0]);
        if (!command) {
          problems.push({
            where,
            message: `runs \`real-a11y ${argv[0]}\`, which is not a command the CLI ships`,
          });
          continue;
        }

        // Placeholders stand in for values; a strict parse would reject
        // `--role <role>` on grounds the reader is not being misled about.
        if (argv.some(isPlaceholder)) continue;

        checked++;
        try {
          parseArgs({
            args: argv.slice(1),
            options: optionsFor(command),
            allowPositionals: true,
            strict: true,
          });
        } catch (err) {
          problems.push({
            where,
            message: `\`${line}\` would not parse — ${err.message}`,
          });
        }
      }
    }
  }
  return { problems, checked };
}

/**
 * MCP tool examples: a JSON object under a tool's heading is that tool's
 * arguments, so it has to satisfy the tool's own input schema.
 *
 * Association is by position — the nearest preceding `### tool_name` heading —
 * which is how a reader reads it too.
 */
export async function checkToolExamples(repoRoot, manifest, validate) {
  const problems = [];
  const schemas = new Map(manifest.mcp.tools.map((t) => [t.name, t]));
  const file = "website/packages/mcp/tools.md";

  let text;
  try {
    text = await readDoc(repoRoot, file);
  } catch {
    return problems; // the page moved; the docs check will say so
  }

  const toolHeadings = headings(text)
    .filter((h) => schemas.has(h.text.replace(/`/g, "").trim()))
    .map((h) => ({ name: h.text.replace(/`/g, "").trim(), line: h.line }));

  for (const block of fencedBlocks(text)) {
    if (block.lang !== "json") continue;
    const body = block.lines.map((l) => l.text).join("\n");

    // Some blocks are annotated call sequences (`// open_page(…)`), not
    // arguments. They aren't JSON, and they aren't claims about a schema.
    let args;
    try {
      args = JSON.parse(body);
    } catch {
      continue;
    }
    if (args === null || typeof args !== "object" || Array.isArray(args))
      continue;

    const owner = [...toolHeadings]
      .reverse()
      .find((h) => h.line < block.startLine);
    if (!owner) continue;

    for (const message of validate(schemas.get(owner.name).inputSchema, args)) {
      problems.push({
        where: `${file}:${block.startLine}`,
        message: `example for \`${owner.name}\` ${message}`,
      });
    }
  }
  return problems;
}
