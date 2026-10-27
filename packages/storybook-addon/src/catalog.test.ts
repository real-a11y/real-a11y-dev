// The Storybook integration catalog (storybook.js.org/addons) builds this
// addon's card from the published `package.json`, so the manifest IS the
// listing. Nothing in the build reads these fields, and every way of getting
// them wrong is silent: the card falls back to the scoped package name and the
// default Storybook icon, or the addon lands in no category. The rules come
// from https://storybook.js.org/docs/addons/integration-catalog.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface Manifest {
  keywords: string[];
  storybook: {
    displayName: string;
    icon: string;
    supportedFrameworks?: string[];
    unsupportedFrameworks?: string[];
  };
}

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgDir, "..", "..");
const pkg: Manifest = JSON.parse(
  readFileSync(join(pkgDir, "package.json"), "utf8"),
);

/** The category tags in the catalog's sidebar. */
const CATEGORIES = [
  "essentials",
  "code",
  "data-state",
  "test",
  "style",
  "design",
  "appearance",
  "organize",
];

/** The only framework names the catalog indexes; it drops anything else. */
const FRAMEWORKS = [
  "react",
  "vue",
  "angular",
  "web-components",
  "ember",
  "html",
  "svelte",
  "preact",
  "react-native",
];

const RAW_MAIN =
  "https://raw.githubusercontent.com/real-a11y/real-a11y-dev/main/";

/**
 * `existsSync` with the case check GitHub makes: raw.githubusercontent.com is
 * case-sensitive, and the Windows and macOS filesystems are not.
 */
function existsWithExactCase(root: string, relative: string): boolean {
  let dir = root;
  for (const segment of relative.split("/")) {
    if (!existsSync(dir) || !readdirSync(dir).includes(segment)) return false;
    dir = join(dir, segment);
  }
  return true;
}

describe("Storybook catalog metadata", () => {
  it("leads its keywords with storybook-addon, then a catalog category", () => {
    expect(pkg.keywords[0]).toBe("storybook-addon");
    expect(CATEGORIES).toContain(pkg.keywords[1]);
  });

  it("gives the card a display name", () => {
    expect(pkg.storybook.displayName).toBeTruthy();
  });

  // The catalog renders no SVG, and an icon URL that 404s because its file
  // moved just shows the default icon. The URL is pinned to main, so the file
  // has to exist at that path in the repo.
  it("points the icon at a raster image that exists in this repo", () => {
    const { icon } = pkg.storybook;
    expect(icon).not.toMatch(/\.svg$/i);
    expect(icon.startsWith(RAW_MAIN)).toBe(true);
    const path = icon.slice(RAW_MAIN.length);
    expect(
      existsWithExactCase(repoRoot, path),
      `storybook-addon's package.json#storybook.icon hotlinks ${path} for ` +
        "the Storybook catalog card; move the URL along with the file",
    ).toBe(true);
  });

  // With neither list, the catalog drops the card's "Works with" section.
  it("names its frameworks, using only names the catalog indexes", () => {
    const { supportedFrameworks = [], unsupportedFrameworks = [] } =
      pkg.storybook;
    const named = [...supportedFrameworks, ...unsupportedFrameworks];
    expect(named.length).toBeGreaterThan(0);
    for (const framework of named) expect(FRAMEWORKS).toContain(framework);
  });
});
