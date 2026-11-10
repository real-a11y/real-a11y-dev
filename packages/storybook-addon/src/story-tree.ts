/**
 * The panel's tree, marked with what each update the story sends changed, as
 * the inspector's tree is (`usePageChanges` in the shared panel): the Preact
 * half of the manager panel (`manager.tsx`), rendered into its shadow root.
 *
 * The updates come over the channel, and so does what the user does on the
 * story (`EVENTS.USER_INPUT`): a click on the story starts a run of updates
 * that is said, as a click on the page is in the inspector. Each update is
 * compared with the one before it, if that one is of its generation
 * (`StoryRead.generation`) and its extraction, whose node ids name the same
 * elements, and wasn't read before the story rendered
 * (`TreeUpdatePayload.storyRendered`).
 */
import {
  isUserInput,
  type ActionType,
  type ExtractionResult,
  type RowScope,
} from "@real-a11y-dev/core";
import {
  semanticTreeRules,
  shownChanges,
  TreePanel,
  usePageChanges,
  type TreePanelProps,
} from "@real-a11y-dev/semantic-navigator-ui";
import { h } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { EVENTS, type TreeUpdatePayload } from "./constants.js";

/** An update the story sent, as the panel shows it. */
export interface StoryRead {
  payload: TreeUpdatePayload;
  /** The payload's tree, with the expansion of the tree before it. */
  tree: ExtractionResult;
  /**
   * Which run of updates this is one of: a new one starts when the panel is
   * shown, when the story changes and when the preview reloads, and nothing
   * is compared across two. A number rather than a flag on a run's first
   * update, which is lost when React renders two updates as one.
   */
  generation: number;
}

/** The part of Storybook's channel the tree listens on. */
export interface InputChannel {
  on(event: string, listener: (input: unknown) => void): void;
  off(event: string, listener: (input: unknown) => void): void;
}

export interface StoryTreeProps extends Omit<
  TreePanelProps,
  "treeData" | "changes" | "enableDiff" | "diffActive" | "onToggleDiff"
> {
  read: StoryRead;
  /** Mark what each update changed (the `realA11y.markChanges` parameter). */
  markChanges: boolean;
  channel: InputChannel;
}

/**
 * The rows that are the story's, as each update said (`storyRows`), kept for
 * the rows that go: one gone answers as it did while it was there.
 */
function storyRowScope() {
  let rootId: string | null = null;
  const kept = new Map<string, boolean>();
  const scope: RowScope = {
    has: (id) => kept.get(id) ?? true,
    isRoot: (id) => id === rootId,
  };
  return {
    scope,
    note({ tree, storyRows }: TreeUpdatePayload) {
      rootId = storyRows?.rootId ?? tree.rootId;
      const outside = new Set(storyRows?.outside);
      for (const [id] of tree.nodes) {
        kept.set(id, id !== rootId && !outside.has(id));
      }
    },
    clear() {
      rootId = null;
      kept.clear();
    },
  };
}

export function StoryTree({
  read,
  markChanges,
  channel,
  onActivate,
  ...panel
}: StoryTreeProps) {
  const extraction = read.payload.mode === "dom" ? "dom" : "a11y";
  const [rows] = useState(storyRowScope);
  const rules = useMemo(
    () => semanticTreeRules(extraction, rows.scope),
    [extraction, rows],
  );
  const changes = usePageChanges({ rules, live: markChanges, doc: null });
  const { noteRead, noteInput, noteAction, reset } = changes;

  // The tree on screen, which the next update replaces.
  const onScreen = useRef<{
    tree: ExtractionResult;
    generation: number;
    extraction: string;
    rendered: boolean;
  }>();
  // Before the tree is painted, so a mark comes with the row it marks.
  useLayoutEffect(() => {
    const last = onScreen.current;
    // Not with a tree read before the story rendered: what its first render
    // brings is the story, not a change to it.
    const compared =
      last?.generation === read.generation &&
      last.extraction === extraction &&
      last.rendered;
    if (!compared) {
      reset();
      rows.clear();
    }
    rows.note(read.payload);
    noteRead(compared ? last.tree : null, read.tree);
    onScreen.current = {
      tree: read.tree,
      generation: read.generation,
      extraction,
      rendered: read.payload.storyRendered !== false,
    };
  }, [read, extraction, rows, reset, noteRead]);

  // The other mode picked: its tree is on its way, and what was marked on
  // this one goes now rather than when it comes.
  const picked = panel.viewMode === "dom" ? "dom" : "a11y";
  useLayoutEffect(() => {
    if (onScreen.current && picked !== onScreen.current.extraction) reset();
  }, [picked, reset]);

  useEffect(() => {
    const hear = (input: unknown) => {
      if (isUserInput(input)) noteInput(input);
    };
    channel.on(EVENTS.USER_INPUT, hear);
    return () => channel.off(EVENTS.USER_INPUT, hear);
  }, [channel, noteInput]);

  return h(TreePanel, {
    ...panel,
    treeData: read.tree,
    changes: shownChanges(changes, markChanges),
    onActivate: (nodeId: string, action: ActionType) => {
      // What the action changes on the story is the user's doing.
      noteAction();
      onActivate?.(nodeId, action);
    },
  });
}
