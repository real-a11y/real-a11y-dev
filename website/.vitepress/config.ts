import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

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

/**
 * Which channel this build is for.
 *
 *   real-a11y.dev       the released docs — deployed from a successful publish
 *   next.real-a11y.dev  `main`, deployed on every push
 *
 * The two builds are NOT interchangeable, which is why this is a build-time
 * switch rather than a runtime one: `next` has to be excluded from search, and
 * a single artifact cannot be both indexed and not.
 *
 * Reproduce the next build locally with `DOCS_CHANNEL=next pnpm --filter
 * @real-a11y-dev/website build` — everything below keys off this one value.
 */
const CHANNEL = process.env.DOCS_CHANNEL === "next" ? "next" : "stable";
const isNext = CHANNEL === "next";

/**
 * The canonical host stays `real-a11y.dev` on BOTH channels, deliberately.
 *
 * Every `next` page declares the stable page as its canonical, which is what
 * tells a crawler the two copies are one document and stable is the real one.
 * Pointing canonical at `next.` would be the bug — it would invite indexing of
 * docs describing unreleased software.
 */
const SITE = "https://real-a11y.dev";

/**
 * The version label in the nav — read from the manifests, never hand-written.
 *
 * It replaces a hardcoded `v0.1 · Beta` that had never changed and could not:
 * it read the same at `0.1.0-beta.1` as it would at `0.1.0-beta.40`, so a
 * reader had no way to tell whether the page in front of them described the
 * version `npm install` had just given them.
 *
 * WHY THE LINKED COHORT, AND NOT "the version"
 *
 * There isn't one. The linked packages move together while `cli` and `mcp`
 * version independently and lag — beta.5 against the cohort's beta.15 — so any
 * single number is wrong for something. The cohort's identifies the RELEASE
 * CUT these docs were built from, which is a real question with a real answer
 * now that the site deploys once per publish. Readers needing per-package
 * precision get it where it matters: the "not published yet" notice names the
 * exact package and version it is talking about.
 *
 * WHY IT IS LOOKED UP RATHER THAN NAMED
 *
 * The first version of this hardcoded `@real-a11y-dev/core`, which was the
 * cohort's anchor at the time. #325 then made `core` private, and it stopped
 * being versioned — so that label would now read `v0.1.0-beta.13`, the version
 * of a package nobody can install, while the published cohort sat at beta.15.
 * Confidently wrong, which is the one thing this label exists to stop being.
 *
 * So the cohort is read from `.changeset/config.json`, which is what actually
 * decides it: the packages listed under `linked` are versioned together by
 * definition, and the file is updated in the same PR that changes the shape of
 * the release. A repackaging like #325 now moves the label with it.
 */
const RELEASE_LABEL = releaseLabel();

function releaseLabel(): string {
  // `next` names the release it is AHEAD of, which is the more useful fact
  // there: the reader wants to know what they would get if they installed
  // today, not what this branch will eventually become.
  const stable = cohortVersion("../../docs/surface.json");
  if (!isNext) return stable ? `v${stable}` : "Beta";

  const released = cohortVersion("../../docs/surface.released.json");
  return released ? `next · ahead of ${released}` : "next · unreleased";
}

/**
 * The linked cohort's version out of a surface manifest, or null.
 *
 * Null is a real answer, not a failure to handle: `surface.released.json` does
 * not exist until the first release cut writes it, and a docs build must not
 * depend on a file whose whole design is to be absent at first. Every caller
 * falls back to a label that claims nothing rather than a number that might be
 * wrong — the same rule the notice follows.
 *
 * A cohort member that is PRIVATE is skipped rather than trusted. Privatising a
 * package stops `changeset version` bumping it while it may still be listed as
 * linked, which is exactly how the hardcoded version of this went stale.
 */
function cohortVersion(relative: string): string | null {
  try {
    const linked = readJson("../../.changeset/config.json").linked?.[0];
    if (!Array.isArray(linked) || linked.length === 0) return null;

    const packages = readJson(relative).packages ?? [];
    for (const name of linked) {
      const pkg = packages.find((p) => p.name === name);
      if (pkg && !pkg.private && typeof pkg.version === "string") {
        return pkg.version;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a repo-relative JSON file.
 *
 * Throws on a missing or malformed file rather than returning a default — the
 * one caller wraps it, and turning "the manifest is broken" into a silent empty
 * object there would produce a label that claims nothing for a reason nobody
 * could diagnose.
 */
function readJson(relative: string): {
  packages?: { name?: string; version?: string; private?: boolean }[];
  linked?: string[][];
} {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

export default defineConfig({
  title: "Real A11y",
  description:
    "Accessibility tooling that works in the real world — semantic tree extraction, testing utilities, React integration, and Storybook panel.",
  lang: "en-US",

  // Emit sitemap.xml for search engines (matches robots.txt reference).
  //
  // NOT on `next`. The hostname below is stable's, so a sitemap built for
  // `next` would advertise real-a11y.dev URLs from a host that does not serve
  // them — a crawler instruction that is simply false. `next` ships no sitemap
  // at all rather than a wrong one.
  sitemap: isNext ? undefined : { hostname: SITE },

  // Drop .html extensions — friendlier URLs, cleaner sitemap.
  cleanUrls: true,

  /**
   * `next` replaces the shipped robots.txt.
   *
   * `website/public/robots.txt` is `Allow: /` and points at stable's sitemap —
   * correct for stable, and exactly wrong served from `next.`, where it would
   * invite a crawl of the copy we just marked `noindex`.
   *
   * Done here rather than in the deploy workflow so that
   * `DOCS_CHANNEL=next pnpm build` produces byte-identical output to CI. A
   * post-build step in the workflow would mean the thing you can inspect
   * locally is not the thing that ships.
   */
  async buildEnd({ outDir }) {
    if (!isNext) return;
    await writeFile(
      join(outDir, "robots.txt"),
      ["User-agent: *", "Disallow: /", ""].join("\n"),
      "utf8",
    );
  },

  vite: {
    resolve: {
      alias: [
        {
          // Give the home page's linked feature cards an accessible name —
          // Chromium computes none, because the `<a>` wraps an `<article>`.
          // See `theme/components/LabeledFeature.vue` for why and for what
          // the name is.
          //
          // The exact relative specifier, not VitePress's documented
          // `/^.*\/VPFeature\.vue$/`: the wide pattern also matches the
          // package-path import inside the replacement, which would alias
          // that file to itself. `VPFeatures.vue` is the only importer, and
          // it writes it exactly this way.
          find: "./VPFeature.vue",
          replacement: fileURLToPath(
            new URL("./theme/components/LabeledFeature.vue", import.meta.url),
          ),
        },
      ],
    },
  },

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
    const href = `${SITE}/${path}`.replace(/\/$/, "/");
    const tags: [string, Record<string, string>][] = [
      [
        "link",
        {
          rel: "canonical",
          href: href === `${SITE}/` ? `${SITE}/` : href,
        },
      ],
    ];

    // `next` is excluded from search outright.
    //
    // The canonical above already tells a crawler which copy is real, and on
    // its own it would probably hold. But "probably" is the wrong standard for
    // a second, permanently-out-of-date copy of the documentation: canonical is
    // a HINT that search engines are free to overrule, while `noindex` is a
    // directive. The failure mode if it is overruled — someone finding docs for
    // unreleased software through a search and installing against them — is the
    // exact thing this whole channel split exists to prevent.
    if (isNext) {
      tags.push(["meta", { name: "robots", content: "noindex, nofollow" }]);
    }
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
      // Was `/packages/core` until core went internal. The nav needs a landing
      // page that is both published and the likeliest first stop; the CLI is
      // the one you can run without installing anything.
      { text: "Packages", link: "/packages/cli" },
      {
        // Which release these docs describe. `noindex` keeps `next` out of
        // search, but a direct link still lands someone on either channel with
        // no way to tell which copy they are reading — so this is the signal
        // that distinguishes them, and on stable it is also the answer to "do
        // these docs match what I just installed". See `releaseLabel` above.
        text: RELEASE_LABEL,
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
          { text: "Agent Skills", link: "/guide/agent-skills" },
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
