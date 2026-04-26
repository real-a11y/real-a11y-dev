// Create a Chrome Web Store upload zip from the built extension.
//
// Invoked by `pnpm package` after `pnpm build`. Writes
// `semantic-navigator-v<version>.zip` alongside the package root so it's easy
// to grab for CWS upload.
//
// Implementation uses a pure-node approach via `node:zlib` + a minimal ZIP
// writer so we don't have to add a devDependency like `bestzip` or `adm-zip`.
// The ZIP format is simple enough that ~80 lines of STORE-only entries
// (no compression) does the job for a 100 KB extension.

import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = resolve(pkgRoot, "dist");

async function main() {
  const pkg = JSON.parse(
    await readFile(resolve(pkgRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(resolve(pkgRoot, "public", "manifest.json"), "utf8"),
  );
  const version = manifest.version || pkg.version;
  const outZip = resolve(pkgRoot, `semantic-navigator-v${version}.zip`);

  const files = [];
  await collect(distDir, files);
  if (files.length === 0) {
    throw new Error(
      `No files under ${distDir} — run \`pnpm build\` before \`pnpm package\`.`,
    );
  }

  const entries = [];
  const centralDir = [];
  let offset = 0;

  for (const abs of files) {
    const name = relative(distDir, abs).replace(/\\/g, "/");
    const data = await readFile(abs);
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0; // 8 = DEFLATE, 0 = STORE
    const crc = crc32(data);

    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // method
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14); // crc-32
    local.writeUInt32LE(body.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // filename length
    local.writeUInt16LE(0, 28); // extra length

    entries.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir sig
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0x21, 14); // date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset

    centralDir.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centralDir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // start disk
  end.writeUInt16LE(files.length, 8); // entries on this disk
  end.writeUInt16LE(files.length, 10); // total entries
  end.writeUInt32LE(centralBuf.length, 12); // size of central dir
  end.writeUInt32LE(offset, 16); // offset to central dir
  end.writeUInt16LE(0, 20); // comment length

  const zip = Buffer.concat([...entries, centralBuf, end]);
  await writeFile(outZip, zip);

  const kb = (zip.length / 1024).toFixed(1);
  console.log(
    `Wrote ${relative(pkgRoot, outZip)} (${files.length} files, ${kb} KB)`,
  );
}

async function collect(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await collect(p, out);
    else if (entry.isFile()) out.push(p);
  }
}

// Node's `zlib.crc32` was added in 22.2. Fall back for older.
if (typeof crc32 !== "function") {
  throw new Error(
    "node:zlib crc32 is unavailable; upgrade to Node 22.2+ or install a crc32 dep.",
  );
}

// Silence unused-import warning in editors: createReadStream isn't used, but
// keeping the import makes the dependency surface explicit if we switch to a
// streamed implementation later.
void createReadStream;
void stat;
void mkdir;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
