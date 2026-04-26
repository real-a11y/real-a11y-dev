import { describe, it, expect, beforeEach } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractDomTree } from "./dom-extractor.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractDomTree", () => {
  it("extracts a simple DOM tree", () => {
    const root = createPage(`
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main>
        <h1>Welcome</h1>
        <p>Hello world</p>
      </main>
    `);

    const { nodes, rootId } = extractDomTree(root);

    expect(rootId).toBeTruthy();
    expect(nodes.size).toBeGreaterThan(0);

    const rootNode = nodes.get(rootId);
    expect(rootNode).toBeDefined();
    expect(rootNode!.dom.tagName).toBe("div");
    expect(rootNode!.depth).toBe(0);
    expect(rootNode!.parentId).toBe(null);
  });

  it("assigns correct parent-child relationships", () => {
    const root = createPage("<ul><li>One</li><li>Two</li></ul>");
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    // Root div has one child: ul
    expect(rootNode.childIds.length).toBe(1);

    const ulId = rootNode.childIds[0];
    const ulNode = nodes.get(ulId)!;
    expect(ulNode.dom.tagName).toBe("ul");
    expect(ulNode.childIds.length).toBe(2);

    const li1 = nodes.get(ulNode.childIds[0])!;
    const li2 = nodes.get(ulNode.childIds[1])!;
    expect(li1.dom.tagName).toBe("li");
    expect(li2.dom.tagName).toBe("li");
    expect(li1.parentId).toBe(ulId);
    expect(li2.parentId).toBe(ulId);
  });

  it("computes accessible names from aria-label", () => {
    const root = createPage('<button aria-label="Close dialog">X</button>');
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const btnId = rootNode.childIds[0];
    const btn = nodes.get(btnId)!;
    expect(btn.a11y.name).toBe("Close dialog");
  });

  it("computes accessible names from text content", () => {
    const root = createPage("<button>Submit</button>");
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const btn = nodes.get(rootNode.childIds[0])!;
    expect(btn.a11y.name).toBe("Submit");
  });

  it("computes accessible names from alt attribute", () => {
    const root = createPage('<img alt="Logo" src="logo.png">');
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const img = nodes.get(rootNode.childIds[0])!;
    expect(img.a11y.name).toBe("Logo");
  });

  it("detects interactive elements", () => {
    const root = createPage(`
      <a href="/page">Link</a>
      <button>Click me</button>
      <input type="text" placeholder="Name">
      <div>Static</div>
    `);

    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;

    const link = nodes.get(rootNode.childIds[0])!;
    const button = nodes.get(rootNode.childIds[1])!;
    const input = nodes.get(rootNode.childIds[2])!;
    const div = nodes.get(rootNode.childIds[3])!;

    expect(link.interaction.isInteractive).toBe(true);
    expect(link.interaction.actions).toContain("navigate");

    expect(button.interaction.isInteractive).toBe(true);
    expect(button.interaction.actions).toContain("click");

    expect(input.interaction.isInteractive).toBe(true);
    expect(input.interaction.actions).toContain("focus");

    expect(div.interaction.isInteractive).toBe(false);
  });

  it("computes correct roles", () => {
    const root = createPage(`
      <nav aria-label="Main">
        <a href="/">Home</a>
      </nav>
      <main>
        <h1>Title</h1>
        <article>
          <p>Content</p>
        </article>
      </main>
    `);

    const { nodes, rootId } = extractDomTree(root);

    const allNodes = Array.from(nodes.values());
    const nav = allNodes.find((n) => n.dom.tagName === "nav")!;
    const link = allNodes.find((n) => n.dom.tagName === "a")!;
    const main = allNodes.find((n) => n.dom.tagName === "main")!;
    const h1 = allNodes.find((n) => n.dom.tagName === "h1")!;
    const article = allNodes.find((n) => n.dom.tagName === "article")!;
    const p = allNodes.find((n) => n.dom.tagName === "p")!;

    expect(nav.a11y.role).toBe("navigation");
    expect(link.a11y.role).toBe("link");
    expect(main.a11y.role).toBe("main");
    expect(h1.a11y.role).toBe("heading");
    expect(article.a11y.role).toBe("article");
    expect(p.a11y.role).toBe("paragraph");
  });

  it("captures ARIA states", () => {
    const root = createPage(`
      <button aria-expanded="true" aria-pressed="false">Toggle</button>
      <input type="checkbox" checked disabled>
    `);

    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;

    const btn = nodes.get(rootNode.childIds[0])!;
    expect(btn.a11y.states["expanded"]).toBe(true);
    expect(btn.a11y.states["pressed"]).toBe(false);

    const checkbox = nodes.get(rootNode.childIds[1])!;
    expect(checkbox.a11y.states["disabled"]).toBe(true);
    expect(checkbox.a11y.states["checked"]).toBe(true);
  });

  it("skips script and style elements", () => {
    const root = createPage(`
      <p>Visible</p>
      <script>alert('hi')</script>
      <style>.x{color:red}</style>
    `);

    const { nodes } = extractDomTree(root);
    const allTags = Array.from(nodes.values()).map((n) => n.dom.tagName);

    expect(allTags).not.toContain("script");
    expect(allTags).not.toContain("style");
    expect(allTags).toContain("p");
  });

  it("records heading levels", () => {
    const root = createPage("<h2>Subtitle</h2>");
    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;
    const h2 = nodes.get(rootNode.childIds[0])!;
    expect(h2.a11y.properties["level"]).toBe("2");
  });

  it("stores key attributes", () => {
    const root = createPage(
      '<a id="home-link" class="nav-link active" href="/home">Home</a>',
    );
    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;
    const link = nodes.get(rootNode.childIds[0])!;

    expect(link.dom.attributes["id"]).toBe("home-link");
    expect(link.dom.attributes["class"]).toBe("nav-link active");
    expect(link.dom.attributes["href"]).toBe("/home");
  });

  it("computes accessible name from wrapping <label> (implicit association)", () => {
    const root = createPage(`
      <label>Full name<input type="text" /></label>
      <label>Email address<input type="email" /></label>
      <label>Message<textarea></textarea></label>
    `);

    const { nodes } = extractDomTree(root);
    const allNodes = Array.from(nodes.values());

    const textInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "text",
    )!;
    expect(textInput.a11y.name).toBe("Full name");

    const emailInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "email",
    )!;
    expect(emailInput.a11y.name).toBe("Email address");

    const textarea = allNodes.find((n) => n.dom.tagName === "textarea")!;
    expect(textarea.a11y.name).toBe("Message");
  });

  it("keeps label[for] association working alongside wrapping labels", () => {
    // label[for] lookup uses ownerDocument.querySelector — requires the
    // elements to be attached to the document (not a detached fragment).
    document.body.innerHTML = `
      <label for="name-input">Name</label>
      <input id="name-input" type="text" />
    `;

    const { nodes } = extractDomTree(document.body);
    const input = Array.from(nodes.values()).find(
      (n) => n.dom.tagName === "input",
    )!;
    expect(input.a11y.name).toBe("Name");

    document.body.innerHTML = ""; // cleanup
  });
});
