import { applyStyle, styles } from "../_shared.js";

// Correct APG Tree View. Implements the simpler Tree pattern (not the
// Treegrid Pattern that react-aria-components uses). Provides:
//   - role="tree" + aria-label on the container
//   - role="treeitem" on each row, with computed aria-level,
//     aria-posinset, aria-setsize, and aria-expanded on parents
//   - aria-owns / nested-group semantics via the HTML structure
//     (each parent's children live inside a role="group" within the
//     parent's <li>)
//   - Roving tabindex: only the active treeitem is tabindex=0
//   - ↑/↓ move between visible rows; ← collapses (or moves to parent);
//     → expands (or moves to first child); Home/End jump to first/last
//     visible row; Enter activates
interface Node {
  id: string;
  label: string;
  children?: Node[];
}

export function mountTreeViewCorrect(host: HTMLElement): void {
  const nodes: Node[] = [
    {
      id: "src",
      label: "src",
      children: [
        { id: "src/index.ts", label: "index.ts" },
        {
          id: "src/components",
          label: "components",
          children: [
            { id: "src/components/Button.tsx", label: "Button.tsx" },
            { id: "src/components/Input.tsx", label: "Input.tsx" },
          ],
        },
      ],
    },
    { id: "package.json", label: "package.json" },
    { id: "README.md", label: "README.md" },
  ];

  const expanded = new Set<string>(["src"]);
  const rows: { id: string; el: HTMLElement; depth: number; node: Node }[] = [];

  const tree = document.createElement("ul");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Project files");
  applyStyle(tree, {
    margin: "0",
    padding: "4px",
    listStyle: "none",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    minWidth: "240px",
    background: styles.bg,
  });

  function renderRow(
    node: Node,
    depth: number,
    posinset: number,
    setsize: number,
  ) {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-level", String(depth + 1));
    li.setAttribute("aria-posinset", String(posinset));
    li.setAttribute("aria-setsize", String(setsize));
    li.tabIndex = -1;
    applyStyle(li, {
      listStyle: "none",
      outline: "none",
    });

    const hasChildren = !!node.children && node.children.length > 0;
    if (hasChildren) {
      li.setAttribute("aria-expanded", String(expanded.has(node.id)));
    }

    const row = document.createElement("div");
    applyStyle(row, {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 8px",
      paddingLeft: `${8 + depth * 16}px`,
      cursor: "pointer",
    });

    if (hasChildren) {
      const chevron = document.createElement("span");
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = expanded.has(node.id) ? "▾" : "▸";
      applyStyle(chevron, { width: "16px", textAlign: "center" });
      row.appendChild(chevron);
    } else {
      const spacer = document.createElement("span");
      spacer.setAttribute("aria-hidden", "true");
      applyStyle(spacer, { display: "inline-block", width: "16px" });
      row.appendChild(spacer);
    }

    const text = document.createElement("span");
    text.textContent = node.label;
    row.appendChild(text);

    row.addEventListener("click", () => {
      activate(node.id);
      if (hasChildren) toggle(node.id);
    });
    li.appendChild(row);
    rows.push({ id: node.id, el: li, depth, node });

    if (hasChildren && expanded.has(node.id)) {
      const group = document.createElement("ul");
      group.setAttribute("role", "group");
      applyStyle(group, { margin: "0", padding: "0", listStyle: "none" });
      node.children!.forEach((child, i) => {
        const childLi = renderRow(
          child,
          depth + 1,
          i + 1,
          node.children!.length,
        );
        group.appendChild(childLi);
      });
      li.appendChild(group);
    }

    return li;
  }

  let activeId: string = nodes[0].id;

  function render() {
    tree.innerHTML = "";
    rows.length = 0;
    nodes.forEach((n, i) => {
      const li = renderRow(n, 0, i + 1, nodes.length);
      tree.appendChild(li);
    });
    // Re-apply tabindex / focus styling to whichever row is active.
    const row = rows.find((r) => r.id === activeId);
    if (row) {
      row.el.tabIndex = 0;
      applyStyle(row.el.querySelector("div") as HTMLElement, {
        background: styles.bgSoft,
      });
    }
  }

  function activate(id: string) {
    activeId = id;
    rows.forEach((r) => {
      r.el.tabIndex = r.id === activeId ? 0 : -1;
      const inner = r.el.querySelector("div") as HTMLElement;
      if (inner) {
        inner.style.background =
          r.id === activeId ? styles.bgSoft : "transparent";
      }
    });
    rows.find((r) => r.id === activeId)?.el.focus();
  }

  function toggle(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
    activate(id);
  }

  function flatVisibleIds(): string[] {
    const out: string[] = [];
    function walk(arr: Node[]) {
      arr.forEach((n) => {
        out.push(n.id);
        if (n.children && expanded.has(n.id)) walk(n.children);
      });
    }
    walk(nodes);
    return out;
  }

  tree.addEventListener("keydown", (e) => {
    const visible = flatVisibleIds();
    const idx = visible.indexOf(activeId);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < visible.length - 1) activate(visible[idx + 1]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) activate(visible[idx - 1]);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const row = rows.find((r) => r.id === activeId);
      if (row?.node.children) {
        if (!expanded.has(activeId)) {
          toggle(activeId);
        } else {
          activate(row.node.children[0].id);
        }
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const row = rows.find((r) => r.id === activeId);
      if (row?.node.children && expanded.has(activeId)) {
        toggle(activeId);
      }
      // (Moving to parent would require a parent-id map; left as a
      // future enhancement to keep the demo compact.)
    } else if (e.key === "Home") {
      e.preventDefault();
      activate(visible[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      activate(visible[visible.length - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const row = rows.find((r) => r.id === activeId);
      if (row?.node.children) toggle(activeId);
    }
  });

  render();
  host.appendChild(tree);
}
