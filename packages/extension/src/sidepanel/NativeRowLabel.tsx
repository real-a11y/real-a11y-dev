/**
 * What a row of Chrome's tree (`NativeTreeView.tsx`) shows after its indent
 * and toggle, up to its action buttons: its label (role, heading level,
 * name, description, value, state badges, jump chips, action tag), its key
 * states, and what the last read found changed on it (the ui package's
 * `tree-changes.ts`).
 */

import { isNativeIframeRole, type ControlsIndex } from "@real-a11y-dev/core";
import {
  JUMP_KEYS,
  KeyStatesForReaders,
  marksForReaders,
  RowChangeTags,
  type RowChangeMarks,
} from "@real-a11y-dev/semantic-navigator-ui";

import type { NativeNode } from "../native/native-actions.js";

import { ControlsChip } from "./ControlsChip.js";
import { announcedValueLabel } from "./field-value.js";
import { EmbeddedBadge, nativeStateBadges, StateBadges } from "./row-badges.js";
import { hasChildren } from "./scope.js";

/** What changed on a row, by field (`FieldChange.field`). */
type Changed = ReadonlySet<string> | undefined;

/** The class that marks a part of the row as what changed: underlined or
 *  outlined where it shows. */
function part(changed: Changed, field: string): string {
  return changed?.has(field) ? " sn-change-part" : "";
}

export function NativeRowLabel({
  node,
  nodes,
  label,
  controlsIndex,
  onJump,
  marks,
}: {
  node: NativeNode;
  /** The tree, for the rows the jump chips name. */
  nodes: ReadonlyMap<string, NativeNode>;
  /** The row's action (`primaryLabel`), if it has one. */
  label: string | undefined;
  controlsIndex: ControlsIndex;
  onJump: (id: string) => void;
  marks: RowChangeMarks;
}) {
  // A heading's level shows as the shared panel's `H2` badge rather
  // than among the generic `key=value` properties below. Only
  // for headings: a tree item or grid row carries a level too.
  const headingLevel =
    node.role === "heading" ? node.properties?.["level"] : undefined;
  const badges = nativeStateBadges(node.states, node.properties, {
    headingLevel,
  });
  const keyBadges = badges.filter((b) => b.keyState);
  const changed = marks.changes && new Set(marks.changes.map((c) => c.field));
  // What a screen reader hears of the tags, last (see `marksForReaders`).
  const said = marksForReaders(marks);
  return (
    <>
      <span class="sn-label">
        <RowHead
          node={node}
          headingLevel={headingLevel}
          keyStates={keyBadges.map((b) => b.label)}
          changed={changed}
        />
        <RowDetails node={node} changed={changed} />
        <StateBadges
          badges={badges.filter((b) => !b.keyState)}
          changed={changed}
        />
        <JumpChips
          id={node.id}
          nodes={nodes}
          controlsIndex={controlsIndex}
          onJump={onJump}
        />
        {label && <span class="sn-action-tag">{label}</span>}
        {said && <span class="sn-sr-only">{said}</span>}
      </span>

      {/* Key states: after the label, which can clip them,
          rather than in it. A row too narrow for them widens
          instead (tree.css, "Long labels"). A screen reader
          hears them after the name (KeyStatesForReaders). */}
      <StateBadges keyStates badges={keyBadges} changed={changed} />

      <RowChangeTags marks={marks} />
    </>
  );
}

/**
 * The role and name, which stay together on a narrow row, which clips the
 * name and drops what follows it (tree.css, "Long labels"), with the key
 * states a screen reader hears after the name.
 */
function RowHead({
  node,
  headingLevel,
  keyStates,
  changed,
}: {
  node: NativeNode;
  headingLevel: string | undefined;
  keyStates: string[];
  changed: Changed;
}) {
  return (
    <span class="sn-head">
      <span class={`sn-role${part(changed, "role")}`}>{node.role}</span>
      {headingLevel && (
        <span class={`sn-level-badge${part(changed, "properties.level")}`}>
          H{headingLevel}
        </span>
      )}
      {isNativeIframeRole(node.role) && !hasChildren(node) && <EmbeddedBadge />}
      {node.name && (
        <span class={`sn-name${part(changed, "name")}`} title={node.name}>
          {node.name}
        </span>
      )}
      <KeyStatesForReaders labels={keyStates} />
    </span>
  );
}

/** The description, and the value or else the placeholder. */
function RowDetails({ node, changed }: { node: NativeNode; changed: Changed }) {
  return (
    <>
      {node.description && (
        <span
          class={`sn-description${part(changed, "description")}`}
          title={node.description}
        >
          {node.description.length > 80
            ? node.description.slice(0, 80) + "…"
            : node.description}
        </span>
      )}
      {/* What a screen reader announces (ADR-0001) — a
          select's option label, not its raw `value`. */}
      {node.value !== undefined && (
        <span
          class={`sn-field-value${part(changed, "value")}`}
          title={announcedValueLabel(node.value)}
        >
          {announcedValueLabel(node.value)}
        </span>
      )}
      {node.value === undefined && node.placeholder && (
        <span
          class={`sn-field-value${part(changed, "placeholder")}`}
          title={`Placeholder hint: ${JSON.stringify(node.placeholder)}`}
        >
          {"placeholder: "}
          {JSON.stringify(node.placeholder)}
        </span>
      )}
    </>
  );
}

/** Jump chips: to the rows this one controls, and back to the rows that
 *  control it. */
function JumpChips({
  id,
  nodes,
  controlsIndex,
  onJump,
}: {
  id: string;
  nodes: ReadonlyMap<string, NativeNode>;
  controlsIndex: ControlsIndex;
  onJump: (id: string) => void;
}) {
  return (
    <>
      {controlsIndex.forward.get(id)?.map((targetId) => {
        const target = nodes.get(targetId);
        if (!target) return null;
        return (
          <ControlsChip
            key={`controls-${targetId}`}
            role={target.role}
            name={target.name}
            direction="forward"
            inferred={controlsIndex.inferred.has(id)}
            keyHint={JUMP_KEYS.forward}
            onJump={() => onJump(targetId)}
          />
        );
      })}
      {controlsIndex.reverse.get(id)?.map((triggerId, i) => {
        const trigger = nodes.get(triggerId);
        if (!trigger) return null;
        return (
          <ControlsChip
            key={`controlled-by-${triggerId}`}
            role={trigger.role}
            name={trigger.name}
            direction="reverse"
            inferred={controlsIndex.inferred.has(triggerId)}
            // Alt+Shift+J reaches the first one.
            keyHint={i === 0 ? JUMP_KEYS.back : undefined}
            onJump={() => onJump(triggerId)}
          />
        );
      })}
    </>
  );
}
