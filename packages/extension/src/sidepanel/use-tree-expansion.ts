/**
 * Which rows of Chrome's tree are open, for `NativeTreeView.tsx`, and the
 * ones it opens by itself: a document's first root and the rows under it, so
 * the page's landmarks show without an extra click and what is deeper starts
 * closed.
 *
 * A document's reads don't always share a root (`ReadTree` in
 * `use-native-changes.ts`): Chromium's own is dropped, so a page with one row
 * at the top is rooted at it, one with more at the synthetic `ax-root`, and
 * an open modal dialog leaves only itself, a native `showModal()` one or one
 * whose page a library hides (`rootIdOf` in `native-core.ts`). So when the
 * root moves, the rows open stay as they are, and only the new root and the
 * rows under it that no read of the document has held yet are added: a
 * dialog opens with its own rows, closing it brings the page back as the
 * user left it, and a page left with one row at the top opens nothing the
 * user had closed. Only another document starts again from its root: no id
 * of one names an element of another, though the same id may come back on
 * one.
 */

import { withRowsOpen } from "@real-a11y-dev/semantic-navigator-ui";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type { NativeNode } from "../native/native-actions.js";

/** The document the tree is of, the read and root it was last drawn from,
 *  and every row the document's reads have held. */
interface Drawn {
  documentKey: string | undefined;
  nodes: Map<string, NativeNode>;
  rootId: string;
  seen: Set<string>;
}

/** The rows a read opens by itself, and whether they replace the rows open
 *  (another document) or join them (a root this document hadn't had). */
interface Seed {
  open: string[];
  fresh: boolean;
}

function seedOf(
  drawn: Drawn | null,
  nodes: Map<string, NativeNode>,
  rootId: string,
  documentKey: string | undefined,
): Seed | null {
  if (!rootId) return null;
  const root = [rootId, ...(nodes.get(rootId)?.childIds ?? [])];
  if (drawn === null || drawn.documentKey !== documentKey) {
    return { open: root, fresh: true };
  }
  if (drawn.rootId === rootId) return null;
  const open = root.filter((id) => !drawn.seen.has(id));
  return open.length > 0 ? { open, fresh: false } : null;
}

/**
 * The rows open, and their setter. `documentKey` names the document the
 * tree is of (`use-native-changes.ts`); without one, every read is taken to
 * be of the same document.
 */
export function useTreeExpansion(
  nodes: Map<string, NativeNode>,
  rootId: string,
  documentKey: string | undefined,
) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const drawn = useRef<Drawn | null>(null);
  // Worked out in the render that brings the read, so what it opens is open
  // in that render rather than from the next. That render's plain effects
  // run as the next one starts, among them `NativeTreeView`'s that drops a
  // selection it can't see, and a new root still closed for them would take
  // the selection under it along. It shows on top of the rows open until the
  // layout effect below has added it there, where the user can close it.
  const seed = useMemo(
    () => seedOf(drawn.current, nodes, rootId, documentKey),
    [nodes, rootId, documentKey],
  );
  const pending =
    drawn.current?.nodes === nodes && drawn.current.documentKey === documentKey
      ? null
      : seed;
  const shown = useMemo(() => {
    if (!pending) return expanded;
    return pending.fresh
      ? new Set(pending.open)
      : withRowsOpen(expanded, pending.open);
  }, [expanded, pending]);
  // A layout effect, so `NativeTreeView`'s that opens a scope root, declared
  // after this hook's call, lands on top of a document's first rows rather
  // than under them.
  useLayoutEffect(() => {
    if (!rootId) return;
    if (seed?.fresh) {
      setExpanded(new Set(seed.open));
    } else if (seed) {
      setExpanded((prev) => withRowsOpen(prev, seed.open));
    }
    const was = drawn.current;
    if (!was || seed?.fresh) {
      drawn.current = {
        documentKey,
        nodes,
        rootId,
        seen: new Set(nodes.keys()),
      };
      return;
    }
    for (const id of nodes.keys()) was.seen.add(id);
    was.nodes = nodes;
    was.rootId = rootId;
  }, [nodes, rootId, documentKey]);
  return [shown, setExpanded] as const;
}
