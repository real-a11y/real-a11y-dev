import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));

/**
 * Copies the viewer's build into a package that ships it. Each one holds this
 * package as a devDependency, so pnpm builds it first.
 */
export function copyViewerBuild(destination: URL): void {
  const out = fileURLToPath(destination);
  mkdirSync(out, { recursive: true });
  for (const file of ["viewer.js", "viewer.css"]) {
    if (!existsSync(dist + file)) {
      throw new Error(
        `${dist}${file} is missing: build @real-a11y-dev/snapshot-viewer first`,
      );
    }
    copyFileSync(dist + file, out + file);
  }
}
