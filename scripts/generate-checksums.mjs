import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ARTIFACT_EXTENSIONS = new Set([".exe", ".zip"]);
const CHECKSUM_FILENAME = "SHA256SUMS.txt";

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function generateChecksums(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  if (artifacts.length === 0) {
    throw new Error(`No .exe or .zip release artifacts found in ${directory}`);
  }

  const lines = [];
  for (const artifact of artifacts) {
    const digest = await hashFile(path.join(directory, artifact));
    lines.push(`${digest}  ${artifact}`);
  }

  const checksumPath = path.join(directory, CHECKSUM_FILENAME);
  await writeFile(checksumPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  return checksumPath;
}

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error("Usage: node scripts/generate-checksums.mjs <bundle-directory>");
  }
  const checksumPath = await generateChecksums(path.resolve(directory));
  console.log(`Wrote ${checksumPath}`);
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
