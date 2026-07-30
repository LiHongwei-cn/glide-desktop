import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateChecksums } from "./generate-checksums.mjs";

test("generates stable SHA-256 hashes for release artifacts only", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "glide-checksums-"));
  context.after(() => rm(directory, { force: true, recursive: true }));

  const installer = Buffer.from("windows-installer");
  const archive = Buffer.from("macos-archive");
  await Promise.all([
    writeFile(path.join(directory, "Glide.exe"), installer),
    writeFile(path.join(directory, "Glide.zip"), archive),
    writeFile(path.join(directory, "ignored.txt"), "not an artifact"),
  ]);

  const checksumPath = await generateChecksums(directory);
  const checksums = await readFile(checksumPath, "utf8");
  const expectedInstallerHash = createHash("sha256")
    .update(installer)
    .digest("hex");
  const expectedArchiveHash = createHash("sha256").update(archive).digest("hex");

  assert.equal(
    checksums,
    `${expectedInstallerHash}  Glide.exe\n${expectedArchiveHash}  Glide.zip\n`,
  );
});

test("fails closed when the bundle contains no supported artifact", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "glide-checksums-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(path.join(directory, "README.txt"), "no installer");

  await assert.rejects(
    generateChecksums(directory),
    /No \.exe or \.zip release artifacts found/,
  );
});
