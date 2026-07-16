import anchor from "markdown-it-anchor";
import { defineConfig } from "vitepress";
import type { ShikiTransformer } from "shiki";

// Shiki wraps every syntax token in a <span> for color. With no role on the
// spans, each one becomes a separate "generic" node in the a11y tree —
// turning a single code block into 30+ rows when inspected with a screen
// reader or our own panel. role="presentation" keeps the DOM intact (so the
// colors keep working) but drops the spans from the a11y tree, leaving the
// <pre><code> as a single accessible code block whose text the user can
// read or copy as one chunk. Same recipe we recommend to consumers in
// /accessibility.
const hideTokenSpans: ShikiTransformer = {
  name: "real-a11y:hide-token-spans",
  span(node) {
    node.properties.role = "presentation";
  },
  line(node) {
    node.properties.role = "presentation";
  },
};

export default defineConfig({
  title: "Real A11y",
  description:
    "Accessibility tooling that works in the real world — semantic tree extraction, testing utilities, React integration, and Storybook panel.",
  lang: "en-US",

  // Emit sitemap.xml for search engines (matches robots.txt reference).
  sitemap: {
    hostname: "https://real-a11y.dev",
  },

  // Drop .html extensions — friendlier URLs, cleaner sitemap.
  cleanUrls: true,

  markdown: {
    // Heading permalink anchors, hidden from assistive tech (GitHub's
    // pattern: aria-hidden + tabindex="-1", still hover/clickable for
    // sighted users). VitePress's default anchor is a real link with
    // aria-label="Permalink to X" INSIDE the heading — per accname §2F
    // that label joins the heading's accessible name, so every heading
    // announces as "X Permalink to 'X'". Our own engine (and axe's
    // aria-hidden-focus rule, satisfied by the tabindex) surfaced it —
    // same fix we'd recommend to consumers.
    anchor: {
      permalink: anchor.permalink.linkInsideHeader({
        symbol: "&ZeroWidthSpace;",
        ariaHidden: true,
        renderAttrs: () => ({ tabindex: "-1" }),
      }),
    },
    codeTransformers: [hideTokenSpans],
    // VitePress's default Shiki themes (`github-light` / `github-dark`)
    // ship a few token colors that fall just under WCAG AA's 4.5:1 on
    // our `--color-bg-subtle` background — e.g. `#d73a49` red at 4.37:1.
    // The `*-high-contrast` variants are designed for AAA (≥7:1), so
    // they clear AA on every token with margin to spare. Surfaced by
    // the website-a11y CI gate — see the @real-a11y-dev/design
    // integration PR thread.
    theme: {
      light: "github-light-high-contrast",
      dark: "github-dark-high-contrast",
    },
  },

  head: [
    ["link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#000000" }],
    // Social card. `og-image.svg` ships as a placeholder; replace
    // `/og-image.png` with a 1200×630 PNG export before launch — most OG
    // scrapers (Twitter, LinkedIn, Slack) prefer PNG over SVG.
    [
      "meta",
      {
        property: "og:image",
        content: "https://real-a11y.dev/og-image.png",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Real A11y" }],
    ["meta", { property: "og:locale", content: "en_US" }],
    ["meta", { property: "og:url", content: "https://real-a11y.dev" }],
    [
      "meta",
      {
        property: "og:title",
        content:
          "Real A11y — accessibility tooling that works in the real world",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Chrome extension, Storybook panel, React integration, and testing library — all powered by the same semantic engine.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:site", content: "@reala11y" }],
    ["meta", { name: "twitter:creator", content: "@darcusfenix" }],
  ],

  // Per-page canonical URL.  Avoids duplicate-content signals when Google
  // indexes both the www and apex variant of the domain.
  transformHead({ pageData }) {
    const path = pageData.relativePath
      .replace(/\.md$/, "")
      .replace(/(^|\/)index$/, "");
    const href = `https://real-a11y.dev/${path}`.replace(/\/$/, "/");
    const tags: [string, Record<string, string>][] = [
      [
        "link",
        {
          rel: "canonical",
          href:
            href === "https://real-a11y.dev/" ? "https://real-a11y.dev/" : href,
        },
      ],
    ];
    // Rich results: SoftwareApplication schema on the homepage.
    if (pageData.relativePath === "index.md") {
      return [
        ...tags,
        [
          "script",
          { type: "application/ld+json" },
          JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Real A11y",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Web, Chrome",
            url: "https://real-a11y.dev",
            description:
              "Accessibility tooling that works in the real world — semantic tree extraction, testing utilities, React integration, Storybook panel, and Chrome extension.",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
            },
            author: {
              "@type": "Person",
              name: "Juan Crisostomo",
              url: "https://x.com/darcusfenix",
            },
          }),
        ],
      ];
    }
    return tags;
  },

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Real A11y",
    // Git-based "Last updated" timestamp in the page footer — freshness signal.
    lastUpdated: true,

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Recipes", link: "/recipes/nextjs" },
      { text: "Packages", link: "/packages/core" },
      {
        text: "v0.1 · Beta",
        items: [
          {
            text: "Changelog",
            link: "https://github.com/real-a11y/real-a11y-dev/releases",
          },
          {
            text: "Contributing",
            link: "https://github.com/real-a11y/real-a11y-dev/blob/main/CONTRIBUTING.md",
          },
          {
            text: "Security",
            link: "https://github.com/real-a11y/real-a11y-dev/blob/main/SECURITY.md",
          },
          {
            text: "Code of Conduct",
            link: "https://github.com/real-a11y/real-a11y-dev/blob/main/CODE_OF_CONDUCT.md",
          },
        ],
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Core Concepts", link: "/guide/core-concepts" },
          {
            text: "Accessibility Snapshots",
            link: "/guide/accessibility-snapshots",
          },
          {
            text: "Snapshots vs. Other Tools",
            link: "/guide/accessibility-snapshots-comparisons",
          },
          { text: "Why Real A11y?", link: "/guide/why" },
        ],
      },
      {
        text: "Reading the Tree",
        items: [
          {
            text: "Understanding the Views",
            link: "/guide/understanding-the-views",
          },
          { text: "DOM View", link: "/guide/reading-the-dom-view" },
          { text: "A11y View", link: "/guide/reading-the-a11y-view" },
          { text: "Headings View", link: "/guide/reading-the-headings-view" },
          { text: "TAB View", link: "/guide/reading-the-tab-view" },
          { text: "Panel features", link: "/guide/panel-features" },
        ],
      },
      {
        text: "Chrome Extension",
        items: [
          { text: "Overview & Install", link: "/guide/chrome-extension" },
        ],
      },
      {
        text: "Packages",
        items: [
          { text: "@real-a11y-dev/core", link: "/packages/core" },
          { text: "@real-a11y-dev/inspector", link: "/packages/inspector" },
          {
            text: "@real-a11y-dev/testing",
            link: "/packages/testing",
            collapsed: true,
            items: [
              { text: "Snapshots", link: "/packages/testing/snapshots" },
              { text: "Assertions", link: "/packages/testing/assertions" },
              { text: "Matchers", link: "/packages/testing/matchers" },
              { text: "Flow API", link: "/packages/testing/flow" },
              {
                text: "Playwright adapter",
                link: "/packages/testing/playwright",
              },
            ],
          },
          { text: "@real-a11y-dev/react", link: "/packages/react" },
          {
            text: "@real-a11y-dev/storybook-addon",
            link: "/packages/storybook-addon",
          },
          {
            text: "@real-a11y-dev/mcp",
            link: "/packages/mcp",
            collapsed: true,
            items: [{ text: "Tools reference", link: "/packages/mcp/tools" }],
          },
          {
            text: "@real-a11y-dev/cli",
            link: "/packages/cli",
            collapsed: true,
            items: [
              { text: "Commands & flags", link: "/packages/cli/commands" },
              { text: "Configuration", link: "/packages/cli/configuration" },
            ],
          },
        ],
      },
      {
        text: "Recipes",
        items: [
          { text: "Next.js (App Router + React 19)", link: "/recipes/nextjs" },
          {
            text: "Storybook 8 + React 19",
            link: "/recipes/storybook-react-19",
          },
          { text: "Peer Dependencies", link: "/recipes/peer-dependencies" },
          { text: "CI Diff Bot", link: "/guide/ci-diff-bot" },
        ],
      },
      {
        text: "Reference",
        items: [
          {
            text: "Authenticated Pages",
            link: "/guide/authenticated-pages",
          },
          { text: "Accessible Names", link: "/guide/accessible-names" },
          { text: "Architecture", link: "/guide/architecture" },
        ],
      },
      {
        text: "Troubleshooting",
        link: "/guide/troubleshooting",
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/real-a11y/real-a11y-dev" },
    ],

    footer: {
      message:
        'Released under the MIT License. · <a href="/privacy">Privacy</a> · <a href="/accessibility">Accessibility</a>',
      copyright: "Copyright © 2024-present Real A11y contributors",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern:
        "https://github.com/real-a11y/real-a11y-dev/edit/main/website/:path",
      text: "Edit this page on GitHub",
    },
  },
});
