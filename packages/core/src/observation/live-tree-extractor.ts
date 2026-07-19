import { buildA11yTree } from "../extraction/a11y-extractor.js";
import {
  extractDomTree,
  getDescendantText,
  getElementRefs,
  isNameBarrierRole,
  isNameFromContentHost,
  resolveFocusedElement,
} from "../extraction/dom-extractor.js";
import { getImplicitRole } from "../extraction/role-map.js";
import type { ExtractionResult, SemanticNode, TreeChange } from "../types.js";
import { getNodeId } from "../utils/id-generator.js";

export interface LiveTreeExtractorOptions {
  /** "a11y" (default) or "dom". */
  mode?: "dom" | "a11y";
}

/**
 * Attributes whose change creates or breaks accessibility references.
 * These are handled with a full re-extraction in the initial implementation
 * because tracking old/new reference targets safely is non-trivial.
 */
const REFERENCE_ATTRS = new Set([
  "id",
  "aria-labelledby",
  "aria-describedby",
  "for",
]);

const PORTAL_OVERLAY_SELECTOR =
  '[aria-modal="true"], dialog, [role="dialog"], [role="alertdialog"], ' +
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], ' +
  '[role="status"], [role="alert"], [role="log"], [aria-live]';

/**
 * Stateful extractor that can patch the previous DOM tree map with only the
 * subtrees that actually changed, falling back to a full extraction when a
 * mutation has non-local accessibility effects.
 *
 * The goal is to turn the steady-state cost of a typing stream or small DOM
 * update from O(page) to O(dirty subtree), while preserving the invariant that
 * the returned tree is identical to what a clean `extractA11yTree(root)` call
 * would produce.
 */
export class LiveTreeExtractor {
  private root: Element;
  public mode: "dom" | "a11y";
  private domNodes = new Map<string, SemanticNode>();
  private a11yNodes = new Map<string, SemanticNode>();
  private rootId = "";
  private focusedId: string | undefined;
  private effectiveRoot: Element | null = null;

  private labelTargetIds = new Set<string>();
  private descriptionTargetIds = new Set<string>();
  /** id -> elements that reference that id via aria-labelledby/aria-describedby */
  private referrersById = new Map<string, Set<Element>>();

  constructor(root: Element, options: LiveTreeExtractorOptions = {}) {
    this.root = root;
    this.mode = options.mode ?? "a11y";
    this.extract();
  }

  /** Perform a full, clean extraction from the configured root. */
  extract(): ExtractionResult {
    const result = extractDomTree(this.root);
    this.adoptResult(result);
    return this.currentResult();
  }

  /**
   * Switch the output mode and re-extract the full tree.
   * Use this when the consumer toggles between DOM and a11y views.
   */
  setMode(mode: "dom" | "a11y"): ExtractionResult {
    this.mode = mode;
    return this.extract();
  }

  /** Refresh the tree for the given change, incrementally when safe. */
  refresh(change?: TreeChange): ExtractionResult {
    if (!change || change.full) {
      return this.extract();
    }

    // Rebuild reference indexes from the live DOM so we can expand the dirty
    // region to cover accessibility dependencies (aria-labelledby, label[for]).
    this.rebuildIndexes();

    const dirty = new Set<Element>();
    let needsFull = false;

    if (change.dirtyRoots) {
      for (const el of change.dirtyRoots) {
        dirty.add(el);
      }
    }

    if (change.mutations) {
      for (const m of change.mutations) {
        if (m.type === "childList") {
          if (this.processChildList(m, dirty)) {
            needsFull = true;
            break;
          }
        } else if (m.type === "attributes") {
          const target = m.target as Element;
          const attr = m.attributeName ?? "";
          if (REFERENCE_ATTRS.has(attr)) {
            needsFull = true;
            break;
          }
          // Re-extracting the target subtree covers both local attribute
          // updates and visibility-affecting changes like aria-hidden/class.
          dirty.add(target);
        } else if (m.type === "characterData") {
          const target = m.target as CharacterData;
          if (target.parentElement) {
            dirty.add(this.nameRelevantAncestor(target.parentElement));
          }
        }
      }
    }

    if (needsFull) {
      return this.extract();
    }

    if (dirty.size === 0) {
      // No actionable dirty roots — return the previous result unchanged.
      return this.currentResult();
    }

    this.expandDependencies(dirty);

    // If the effective root itself is dirty alongside other roots, just do a
    // full extraction; the cost is the same and it avoids splicing hazards.
    if (this.effectiveRoot && dirty.has(this.effectiveRoot) && dirty.size > 1) {
      return this.extract();
    }

    const roots = this.collapseToOutermost(dirty);

    // Verify every outermost root is already represented in the current map.
    for (const r of roots) {
      const id = getNodeId(r);
      if (!this.domNodes.has(id)) {
        return this.extract();
      }
    }

    for (const r of roots) {
      const existing = this.domNodes.get(getNodeId(r));
      if (!existing) {
        return this.extract();
      }
      const { parentId, depth } = existing;
      const rId = getNodeId(r);
      this.deleteSubtree(rId);
      extractDomTree(r, {
        nodes: this.domNodes,
        parentId,
        baseDepth: depth,
        descriptionTargetIds: this.descriptionTargetIds,
        includeFocused: false,
      });
      // If the re-extract skipped the root (it became hidden, or is now an
      // aria-describedby text provider), the parent still references its now
      // deleted id. Drop that dangling child so the DOM map stays consistent
      // with a clean extraction.
      if (!this.domNodes.has(rId) && parentId) {
        const parent = this.domNodes.get(parentId);
        if (parent) {
          parent.childIds = parent.childIds.filter((cid) => cid !== rId);
        }
      }
      this.updateAncestorDescendantText(r);
    }

    this.focusedId = this.resolveFocused();

    if (this.mode === "a11y") {
      const a11y = buildA11yTree(this.domNodes, this.rootId, this.focusedId);
      this.a11yNodes = a11y.nodes;
      this.focusedId = a11y.focusedId;
    }

    return this.currentResult();
  }

  private adoptResult(result: ExtractionResult): void {
    this.domNodes = result.nodes;
    this.rootId = result.rootId;
    this.focusedId = result.focusedId;
    this.effectiveRoot = getElementRefs().get(this.rootId) ?? this.root;
    this.rebuildIndexes();

    if (this.mode === "a11y") {
      const a11y = buildA11yTree(this.domNodes, this.rootId, this.focusedId);
      this.a11yNodes = a11y.nodes;
      this.focusedId = a11y.focusedId;
    } else {
      this.a11yNodes = new Map();
    }
  }

  private currentResult(): ExtractionResult {
    const nodes = this.mode === "a11y" ? this.a11yNodes : this.domNodes;
    return {
      nodes,
      rootId: this.rootId,
      ...(this.focusedId ? { focusedId: this.focusedId } : {}),
    };
  }

  private rebuildIndexes(): void {
    this.labelTargetIds.clear();
    this.descriptionTargetIds.clear();
    this.referrersById.clear();

    const effectiveRoot = this.effectiveRoot ?? this.root;

    for (const el of effectiveRoot.querySelectorAll("[aria-labelledby]")) {
      const ids = (el.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        this.labelTargetIds.add(id);
        this.addReferrer(id, el);
      }
    }

    for (const el of effectiveRoot.querySelectorAll("[aria-describedby]")) {
      const ids = (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        if (!this.labelTargetIds.has(id)) {
          this.descriptionTargetIds.add(id);
        }
        this.addReferrer(id, el);
      }
    }
  }

  private addReferrer(id: string, el: Element): void {
    let set = this.referrersById.get(id);
    if (!set) {
      set = new Set();
      this.referrersById.set(id, set);
    }
    set.add(el);
  }

  private processChildList(
    record: MutationRecord,
    dirty: Set<Element>,
  ): boolean {
    const target = record.target as Element;

    // Any structural change at the document/body/root level is too broad to
    // splice safely without re-evaluating modal/portal scope.
    if (
      target === this.root ||
      target === this.root.ownerDocument.body ||
      target === this.root.ownerDocument.documentElement ||
      target === this.effectiveRoot
    ) {
      return true;
    }

    dirty.add(target);

    // A childList change can be a text replacement delivered as node churn
    // (e.g. `el.textContent = "..."` swaps the text node). If `target` sits
    // inside a name-from-content host, that host's accessible name is built
    // from this text, so it must be re-extracted too — mirroring the
    // characterData path's `nameRelevantAncestor` climb.
    dirty.add(this.nameRelevantAncestor(target));

    const handleNode = (n: Node): boolean => {
      if (n.nodeType !== 1 /* ELEMENT_NODE */) return false;
      const el = n as Element;

      if (
        el.matches?.(PORTAL_OVERLAY_SELECTOR) ||
        el.querySelector?.(PORTAL_OVERLAY_SELECTOR)
      ) {
        return true;
      }

      const id = el.getAttribute("id");
      if (id) {
        const referrers = this.referrersById.get(id);
        if (referrers) {
          for (const ref of referrers) dirty.add(ref);
        }
      }

      for (const attr of ["aria-labelledby", "aria-describedby", "for"]) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        for (const refId of value.split(/\s+/).filter(Boolean)) {
          const refEl = el.ownerDocument?.getElementById(refId);
          if (refEl) dirty.add(refEl);
        }
      }

      return false;
    };

    for (const n of record.addedNodes) {
      if (handleNode(n)) return true;
    }
    for (const n of record.removedNodes) {
      if (handleNode(n)) return true;
    }

    return false;
  }

  private nameRelevantAncestor(el: Element): Element {
    let node: Element | null = el;
    while (
      node &&
      node !== this.root &&
      node !== this.root.ownerDocument?.body &&
      node !== this.root.ownerDocument?.documentElement
    ) {
      if (isNameFromContentHost(node)) return node;
      if (isNameBarrierRole(getImplicitRole(node))) break;
      node = node.parentElement;
    }
    return el;
  }

  private expandDependencies(dirty: Set<Element>): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const el of Array.from(dirty)) {
        const id = el.getAttribute("id");
        if (id) {
          const referrers = this.referrersById.get(id);
          if (referrers) {
            for (const ref of referrers) {
              if (!dirty.has(ref)) {
                dirty.add(ref);
                changed = true;
              }
            }
          }
        }

        if (el.tagName.toLowerCase() === "label") {
          const forId = el.getAttribute("for");
          if (forId) {
            const input = el.ownerDocument?.getElementById(forId);
            if (input && !dirty.has(input)) {
              dirty.add(input);
              changed = true;
            }
          }
        }
      }
    }
  }

  private collapseToOutermost(elements: Set<Element>): Element[] {
    const list = Array.from(elements);
    return list.filter(
      (el) => !list.some((other) => other !== el && other.contains(el)),
    );
  }

  /**
   * After a partial re-extract, the dirty root's own `dom.descendantText` is
   * fresh but every ancestor still holds the old preview. Recompute it for each
   * ancestor up to the configured root.
   *
   * This is a pure text walk (no getComputedStyle), so even walking to the
   * root is much cheaper than re-extracting the whole page.
   */
  private updateAncestorDescendantText(dirtyRoot: Element): void {
    let el: Element | null = dirtyRoot.parentElement;
    while (el) {
      const id = getNodeId(el);
      const node = this.domNodes.get(id);
      if (node) {
        node.dom.descendantText = getDescendantText(el);
      }
      if (el === this.root || el === this.effectiveRoot) break;
      el = el.parentElement;
    }
  }

  private deleteSubtree(nodeId: string): void {
    const node = this.domNodes.get(nodeId);
    if (!node) return;
    for (const childId of [...node.childIds]) {
      this.deleteSubtree(childId);
    }
    this.domNodes.delete(nodeId);
  }

  private resolveFocused(): string | undefined {
    const active = resolveFocusedElement(this.root.ownerDocument);
    if (!active) return undefined;
    const id = getElementRefs().findId(active);
    return id && this.domNodes.has(id) ? id : undefined;
  }
}
