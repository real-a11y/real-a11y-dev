import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Tree View. Deliberately wrong on the hierarchy
// / role axis:
//
//   1. Container is a plain <ul> with NO role="tree", NO aria-label.
//      Reads as a generic list.
//
//   2. Items are plain <li>s with NO role="treeitem", NO aria-level,
//      NO aria-posinset / aria-setsize. Position in hierarchy is
//      visible (indentation) but invisible to AT.
//
//   3. Parent rows have NO aria-expanded. Expand/collapse affordance is
//      a plain <button> with no announced state.
//
//   4. NO roving tabindex.
interface Node {
  id: string;
  label: string;
  children?: Node[];
}

export function mountTreeViewBroken(host: HTMLElement): void {
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

  function render(arr: Node[], depth: number): HTMLElement {
    const ul = document.createElement("ul");
    applyStyle(ul, { margin: "0", padding: "0", listStyle: "none" });
    arr.forEach((n) => {
      const li = document.createElement("li");
      applyStyle(li, { listStyle: "none" });

      const row = document.createElement("div");
      applyStyle(row, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        paddingLeft: `${8 + depth * 16}px`,
      });

      const hasChildren = !!n.children && n.children.length > 0;
      if (hasChildren) {
        const chevron = document.createElement("button");
        chevron.type = "button";
        chevron.textContent = expanded.has(n.id) ? "▾" : "▸";
        applyStyle(chevron, {
          width: "16px",
          height: "16px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: "0",
          font: styles.font,
        });
        chevron.addEventListener("click", () => {
          if (expanded.has(n.id)) expanded.delete(n.id);
          else expanded.add(n.id);
          rerender();
        });
        row.appendChild(chevron);
      } else {
        const spacer = document.createElement("span");
        applyStyle(spacer, { display: "inline-block", width: "16px" });
        row.appendChild(spacer);
      }

      const text = document.createElement("span");
      text.textContent = n.label;
      row.appendChild(text);
      li.appendChild(row);

      if (hasChildren && expanded.has(n.id)) {
        li.appendChild(render(n.children!, depth + 1));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  const container = document.createElement("ul");
  applyStyle(container, {
    margin: "0",
    padding: "4px",
    listStyle: "none",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    minWidth: "240px",
    background: styles.bg,
  });

  function rerender() {
    container.innerHTML = "";
    const tree = render(nodes, 0);
    while (tree.firstChild) container.appendChild(tree.firstChild);
  }

  rerender();
  host.appendChild(container);
}
