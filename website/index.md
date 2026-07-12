---
layout: home

hero:
  name: "Real A11y"
  text: "Accessibility tooling\nthat works in the real world"
  tagline: "Beta (v0.1) — Extracts the accessibility tree as plain data. Use it through a Chrome extension, Storybook panel, React component, testing library, CLI, or MCP server — one engine, every surface."
  image:
    src: /logo.svg
    alt: Real A11y
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Chrome Extension
      link: /guide/chrome-extension

features:
  - icon: 🧩
    title: Chrome extension
    details: "Open the side panel on any website and explore its DOM, A11y, and TAB views live. Highlights elements on the page as you navigate the tree. No code, no setup."
    link: /guide/chrome-extension
    linkText: Install the extension
  - icon: 🌳
    title: One engine, every context
    details: "@real-a11y-dev/core extracts the full semantic tree from any DOM — roles, accessible names, focus state, modal context, live regions. Every other package is just a different lens on that tree."
  - icon: 🧪
    title: Test what users actually experience
    details: "@real-a11y-dev/testing gives you auditSnapshot(), assertHeadingOrder(), assertNoUnlabeledInteractive(), and a fluent flow() chain — all powered by the real accessibility tree, not synthetic mocks."
  - icon: ⌨️
    title: Audit from the shell and CI
    details: "@real-a11y-dev/cli — the real-a11y command audits any URL from the shell with per-instance locators and CI-grade exit codes. snapshot + diff then track accessibility regressions across a PR, findings-aware."
    link: /packages/cli
    linkText: Explore the CLI
  - icon: 🤖
    title: Accessibility for AI agents
    details: "@real-a11y-dev/mcp — a Model Context Protocol server that hands the semantic tree and audits to AI agents over stdio. Point any MCP client at it and the agent can reason about what assistive tech actually perceives."
    link: /packages/mcp
    linkText: Explore the MCP server
  - icon: ⚛️
    title: First-class React support
    details: "useSemanticTree() and useActiveModal() subscribe to DOM mutations via useSyncExternalStore — concurrent-mode safe, no boilerplate. Drop in <SemanticNavigator /> and the tree panel appears."
  - icon: 📖
    title: Storybook panel out of the box
    details: "Install @real-a11y-dev/storybook-addon and every story gets an A11y tree panel showing the semantic structure, heading outline, and tab sequence — updated live as the story renders."
  - icon: 🔒
    title: Shadow DOM isolation by default
    details: "The semantic-navigator embed mounts inside a ShadowRoot so its styles never leak into your app and your app's styles never override the panel. CSS conflicts are eliminated at the architecture level."
---
