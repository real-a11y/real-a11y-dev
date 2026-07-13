/**
 * Unified diff of two serialized-view texts — git-style hunks with context,
 * preserving order and indentation. This is what a reviewer reads to locate a
 * structural change ("the heading flipped, right after the About link, inside
 * the nav"); the multiset `diffViews` throws that away and only feeds the
 * plain-language `--explain` layer.
 *
 * Pure: LCS edit script → hunks with `context` unchanged lines on each side,
 * merging hunks separated by ≤ 2·context equal lines. No external deps.
 */

export interface DiffLine {
  /** " " unchanged (context), "-" removed (base only), "+" added (PR only). */
  tag: " " | "-" | "+";
  text: string;
}

export interface Hunk {
  /** 1-based start line + length on each side, for the `@@ -a,b +c,d @@` header. */
  baseStart: number;
  baseLen: number;
  prStart: number;
  prLen: number;
  lines: DiffLine[];
}

export interface ViewHunks {
  tree: Hunk[];
  outline: Hunk[];
  tabs: Hunk[];
}

const DEFAULT_CONTEXT = 3;

/** Split a serialized view into lines, dropping a single trailing newline's
 * empty tail (views are joined with "\n", no trailing newline, but be safe). */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Op = { tag: " " | "-" | "+"; text: string };

/** LCS-based edit script over two line arrays (two-row DP for the table, then
 * backtrack). Lengths are serialized-view sized (hundreds), well within reach. */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]; (n+1) x (m+1), built bottom-up.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ tag: "-", text: a[i] });
      i++;
    } else {
      ops.push({ tag: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "-", text: a[i++] });
  while (j < m) ops.push({ tag: "+", text: b[j++] });
  return ops;
}

export function unifiedDiff(
  base: string,
  pr: string,
  context: number = DEFAULT_CONTEXT,
): Hunk[] {
  const a = toLines(base);
  const b = toLines(pr);
  const ops = editScript(a, b);
  if (!ops.some((o) => o.tag !== " ")) return [];

  // Indices of changed ops; group any two changes separated by ≤ 2·context
  // context ops into one hunk (so their context windows would overlap/touch).
  const changed = ops.reduce<number[]>((acc, o, idx) => {
    if (o.tag !== " ") acc.push(idx);
    return acc;
  }, []);

  // Emit a hunk spanning changes[from..to] with `context` lines on each side.
  const flush = (hunks: Hunk[], from: number, to: number) => {
    const start = Math.max(0, changed[from] - context);
    const end = Math.min(ops.length - 1, changed[to] + context);
    hunks.push(buildHunk(ops, start, end));
  };
  // Walk consecutive changes; split into a new hunk when the gap between two
  // changes exceeds both their context windows (so the windows wouldn't
  // touch). `changed` is non-empty here (we returned early on an all-equal
  // diff), so the trailing group is always flushed after the loop.
  const hunks: Hunk[] = [];
  let groupStart = 0;
  for (let k = 1; k < changed.length; k++) {
    if (changed[k] - changed[k - 1] - 1 > 2 * context) {
      flush(hunks, groupStart, k - 1);
      groupStart = k;
    }
  }
  flush(hunks, groupStart, changed.length - 1);
  return hunks;
}

/** Materialize a hunk from ops[start..end], computing 1-based line numbers by
 * counting base/PR lines consumed before `start`. */
function buildHunk(ops: readonly Op[], start: number, end: number): Hunk {
  let baseBefore = 0;
  let prBefore = 0;
  for (let idx = 0; idx < start; idx++) {
    if (ops[idx].tag !== "+") baseBefore++;
    if (ops[idx].tag !== "-") prBefore++;
  }
  const lines: DiffLine[] = [];
  let baseLen = 0;
  let prLen = 0;
  for (let idx = start; idx <= end; idx++) {
    const op = ops[idx];
    lines.push({ tag: op.tag, text: op.text });
    if (op.tag !== "+") baseLen++;
    if (op.tag !== "-") prLen++;
  }
  return {
    // A zero-length side conventionally starts at the line before it; clamp to
    // 0 only when the whole side is empty.
    baseStart: baseLen === 0 ? baseBefore : baseBefore + 1,
    baseLen,
    prStart: prLen === 0 ? prBefore : prBefore + 1,
    prLen,
    lines,
  };
}

/** `@@ -a,b +c,d @@` (git-style; the `,b`/`,d` omitted when length is 1, as git does). */
export function hunkHeader(h: Hunk): string {
  const range = (start: number, len: number) =>
    len === 1 ? `${start}` : `${start},${len}`;
  return `@@ -${range(h.baseStart, h.baseLen)} +${range(h.prStart, h.prLen)} @@`;
}

/** Total rendered lines a set of hunks would emit (header + body per hunk) —
 * for the --max-lines cap. */
export function hunkLineCount(hunks: readonly Hunk[]): number {
  return hunks.reduce((sum, h) => sum + 1 + h.lines.length, 0);
}
