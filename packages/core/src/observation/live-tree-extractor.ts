import { buildA11yTree } from "../extraction/a11y-extractor.js";
import {
  extractDomTree,
  getDescendantText,
  getElementRefs,
  isNameBarrierRole,
  isNameFromContentHost,
  resolveEffectiveRoot,
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

/**
 * Attributes whose change can move the extraction *scope* — either by creating
 * or destroying a modal/overlay candidate (`aria-modal`, `role`, `open`) or by
 * flipping one's visibility, its own or an ancestor's (`class`, `style`,
 * `hidden`, `inert`), since `findActiveModal`/`findPortalOverlay` both gate on
 * visibility.
 *
 * A hit here does NOT force a full extraction. It only arms ONE
 * `resolveEffectiveRoot()` recomputation for the whole batch; the full
 * extraction happens only if the scope actually moved.
 *
 * Deciding from the mutated element alone would be both too narrow and far too
 * broad. Too narrow: the common Vue-Teleport / Angular-CDK pattern hides an
 * overlay by toggling `display` on a ROLELESS wrapper, and `isActuallyVisible`
 * consults the whole ancestor chain — a wrapper matches no overlay selector, so
 * the rescope would be missed. Too broad: an open menu repositioned by Floating
 * UI rewrites inline `style` on the `[role="menu"]` element every scroll frame
 * without the scope ever changing, and each of those would have forced a
 * full-page walk.
 */
const SCOPE_ATTRS = new Set([
  "aria-modal",
  "role",
  "open",
  "class",
  "style",
  "hidden",
  "inert",
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
  /**
   * The scope `resolveEffectiveRoot()` reported at the last full extraction.
   *
   * Deliberately NOT the same as `effectiveRoot`, which is recovered from the
   * materialized root NODE and silently falls back to `this.root` when the
   * scope root produced no node (e.g. an `inert` modal: `checkVisibility()`
   * ignores `inert`, so it is chosen as the scope but then skipped by the walk,
   * leaving `rootId === ""`). Comparing a freshly resolved scope against that
   * fallback would report "moved" on every refresh forever — a permanent
   * full-extract loop, exactly what this class exists to avoid. Compare like
   * with like.
   */
  private scopeRoot: Element;

  private labelTargetIds = new Set<string>();
  private descriptionTargetIds = new Set<string>();
  /** id -> elements that reference that id via aria-labelledby/aria-describedby */
  private referrersById = new Map<string, Set<Element>>();

  constructor(root: Element, options: LiveTreeExtractorOptions = {}) {
    this.root = root;
    // Definite assignment: extract() sets this, but TS can't see through it.
    this.scopeRoot = root;
    this.mode = options.mode ?? "a11y";
    this.extract();
  }

  /** Perform a full, clean extraction from the configured root. */
  extract(): ExtractionResult {
    // Resolve before extracting. Both run in the same synchronous task, so the
    // DOM cannot change between them and `extractDomTree` is guaranteed to pick
    // this same scope — which is what makes the later `scopeMoved()` comparison
    // meaningful. The duplicated resolution is a tiny fraction of a full walk.
    this.scopeRoot = resolveEffectiveRoot(this.root);
    const result = extractDomTree(this.root);
    this.adoptResult(result);
    return this.currentResult();
  }

  /**
   * True if the extraction scope moved since the last full extraction.
   *
   * Strictly cheaper than the `extract()` it guards — `extract()` performs this
   * exact resolution as its first step — so checking is never a net loss.
   */
  private scopeMoved(): boolean {
    return resolveEffectiveRoot(this.root) !== this.scopeRoot;
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
    let scopeSuspect = false;

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
          // Arm the scope check but keep going: one recomputation covers the
          // whole batch however many mutations it holds. Deliberately NOT a
          // decision based on `target` alone — see SCOPE_ATTRS.
          if (SCOPE_ATTRS.has(attr)) {
            scopeSuspect = true;
          }
          // Re-extracting the target subtree covers both local attribute
          // updates and visibility-affecting changes like aria-hidden/class.
          dirty.add(target);
          // A name-affecting attribute (aria-label, role, alt, title, …) on a
          // descendant also changes the accessible name of an enclosing
          // name-from-content host, which is computed from that descendant's
          // content. Re-extract the host too so its name doesn't go stale.
          dirty.add(this.nameRelevantAncestor(target));
          // A `role` change can turn the target into a name-barrier role, and
          // nameRelevantAncestor reads the post-mutation role, so its climb
          // stops at the now-barrier target and never reaches an enclosing
          // host whose name just lost (or gained) this subtree's text. Climb
          // from the parent so that host is still re-extracted.
          if (attr === "role" && target.parentElement) {
            dirty.add(this.nameRelevantAncestor(target.parentElement));
          }
        } else if (m.type === "characterData") {
          const target = m.target as CharacterData;
          if (target.parentElement) {
            // Add the direct parent too (not just its name host): it may carry
            // the id an aria-labelledby/-describedby referrer points at, and
            // expandDependencies only discovers referrers from elements in the
            // dirty set. Mirrors the attribute / childList branches.
            dirty.add(target.parentElement);
            dirty.add(this.nameRelevantAncestor(target.parentElement));
          }
        }
      }
    }

    // At most ONE resolveEffectiveRoot() per refresh regardless of batch size:
    // a 500-mutation animation burst pays for it once. A scope move can never
    // be spliced — the tree roots somewhere else entirely — so it must fall
    // back to a full extraction.
    if (needsFull || (scopeSuspect && this.scopeMoved())) {
      return this.extract();
    }

    if (dirty.size === 0) {
      // Nothing actionable to splice. The scope can still have moved without
      // producing a usable record — a portal mounting into a container that
      // existed at page load is never seen by the body-level portal observer —
      // so confirm the scope is stable before returning the previous result.
      return this.scopeMoved() ? this.extract() : this.currentResult();
    }

    this.expandDependencies(dirty);

    // If the effective root itself is dirty alongside other roots, just do a
    // full extraction; the cost is the same and it avoids splicing hazards.
    if (this.effectiveRoot && dirty.has(this.effectiveRoot) && dirty.size > 1) {
      return this.extract();
    }

    const roots = this.collapseToOutermost(dirty);

    // Every outermost root must already be represented in the current map;
    // capture where each one sits before anything is deleted.
    const plans: {
      root: Element;
      id: string;
      parentId: string | null;
      depth: number;
    }[] = [];
    for (const r of roots) {
      const id = getNodeId(r);
      const existing = this.domNodes.get(id);
      if (!existing) {
        return this.extract();
      }
      plans.push({
        root: r,
        id,
        parentId: existing.parentId,
        depth: existing.depth,
      });
    }

    // Delete every dirty subtree BEFORE re-extracting any of them. Interleaving
    // the two is unsafe when a node moved between two dirty containers in the
    // same batch: re-extracting the destination re-adds the node under its new
    // parent, and a later deleteSubtree on the source would then follow the
    // source's stale childIds and delete the node that now lives under the
    // destination — dropping it from the tree and leaving the destination
    // pointing at a missing child.
    for (const p of plans) {
      this.deleteSubtree(p.id);
    }

    for (const p of plans) {
      // A root detached earlier in this same batch must not be resurrected.
      // `getComputedStyle` on a detached element reports nothing hidden, so
      // `buildNode` would happily rebuild the subtree that was just removed
      // from the document, leaving it in the map as an orphan (unreachable
      // from the root, but present in `dom` mode output) and pinning the
      // detached elements via elementRefs. Pass 1 already deleted it; leave
      // it deleted and drop the parent's reference.
      if (!p.root.isConnected) {
        this.detachFromParent(p.parentId, p.id);
        continue;
      }
      extractDomTree(p.root, {
        nodes: this.domNodes,
        parentId: p.parentId,
        baseDepth: p.depth,
        descriptionTargetIds: this.descriptionTargetIds,
        includeFocused: false,
      });
      // If the re-extract skipped the root (it became hidden, or is now an
      // aria-describedby text provider), the parent still references its now
      // deleted id. Drop that dangling child so the DOM map stays consistent
      // with a clean extraction.
      if (!this.domNodes.has(p.id)) {
        this.detachFromParent(p.parentId, p.id);
      }
      this.updateAncestorDescendantText(p.root);
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
      source: { producer: "dom" },
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

    const markReferenced = (el: Element): void => {
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
    };

    const handleNode = (n: Node): boolean => {
      if (n.nodeType !== 1 /* ELEMENT_NODE */) return false;
      const el = n as Element;

      if (
        el.matches?.(PORTAL_OVERLAY_SELECTOR) ||
        el.querySelector?.(PORTAL_OVERLAY_SELECTOR)
      ) {
        return true;
      }

      // The id a referrer points at (or a reference attribute) may live on a
      // descendant of the added/removed node, not just the node itself, so
      // scan the whole subtree to keep referrers in sync with a full extract.
      markReferenced(el);
      for (const desc of el.querySelectorAll(
        "[id], [aria-labelledby], [aria-describedby], [for]",
      )) {
        markReferenced(desc);
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

  /**
   * The outermost name-from-content host whose accessible name is computed from
   * `el`'s content. Nested hosts (`<a><h3>text</h3></a>`) both derive their name
   * from the inner text, so re-extracting only the innermost would leave the
   * outer host's name stale — we climb to the outermost, stopping at a
   * name-barrier role, which halts content-name propagation to ancestors.
   * Falls back to `el` when no enclosing host exists.
   */
  private nameRelevantAncestor(el: Element): Element {
    let node: Element | null = el;
    let outermostHost: Element | null = null;
    while (
      node &&
      node !== this.root &&
      node !== this.root.ownerDocument?.body &&
      node !== this.root.ownerDocument?.documentElement
    ) {
      if (isNameFromContentHost(node)) outermostHost = node;
      if (isNameBarrierRole(getImplicitRole(node))) break;
      node = node.parentElement;
    }
    return outermostHost ?? el;
  }

  private expandDependencies(dirty: Set<Element>): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const el of Array.from(dirty)) {
        // Walk the ancestor chain, not just `el`. An aria-labelledby /
        // aria-describedby reference points at a whole element, and the
        // referrer borrows that element's entire text — so a change anywhere
        // inside it makes the referrer's name/description stale. The id
        // commonly sits on a plain wrapper (`<div id="lbl"><span>…</span>`)
        // that is neither the changed node's parent nor a name-from-content
        // host, so nothing else would ever seed it into the dirty set.
        //
        // Stop at the effective root — that is the scope `referrersById` was
        // indexed over, and it may sit ABOVE `this.root` when a portal pivoted
        // extraction to body.
        const stopAt = this.effectiveRoot ?? this.root;
        let ancestor: Element | null = el;
        while (ancestor) {
          const id = ancestor.getAttribute("id");
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
          if (ancestor === stopAt) break;
          ancestor = ancestor.parentElement;
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
      if (node?.dom) {
        node.dom.descendantText = getDescendantText(el);
      }
      if (el === this.root || el === this.effectiveRoot) break;
      el = el.parentElement;
    }
  }

  /**
   * Remove `childId` from its parent's child list, if both still exist.
   * Keeps the map free of parents pointing at nodes that are no longer in it —
   * `buildA11yTree` tolerates a dangling id, but `dom` mode hands the map
   * straight to consumers.
   */
  private detachFromParent(parentId: string | null, childId: string): void {
    if (!parentId) return;
    const parent = this.domNodes.get(parentId);
    if (!parent) return;
    parent.childIds = parent.childIds.filter((cid) => cid !== childId);
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
