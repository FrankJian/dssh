import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveExtractor, extractArchive } from "./rdp-archive.mjs";

test("Windows uses native tar.exe even when Git Bash GNU tar is first on PATH", () => {
  assert.equal(archiveExtractor("win32", "C:\\Windows"), "C:\\Windows\\System32\\tar.exe");
  assert.equal(archiveExtractor("win32", "D:\\Windows"), "D:\\Windows\\System32\\tar.exe");
  assert.throws(() => archiveExtractor("win32", undefined), /SystemRoot/);
  assert.equal(archiveExtractor("darwin"), "tar");
});

test("Windows extraction sends archive bytes over stdin instead of a drive-prefixed -f path", () => {
  const dir = mkdtempSync(join(tmpdir(), "dssh-archive-test-"));
  try {
    const archive = join(dir, "source archive.tar.gz");
    const bytes = Buffer.from("synthetic archive bytes");
    writeFileSync(archive, bytes);
    let calls = 0;
    extractArchive(archive, "D:\\a\\dssh\\dssh\\.cache\\rdp", {
      platform: "win32", systemRoot: "C:\\Windows",
      execute(command, args, options) {
        calls++;
        assert.equal(command, "C:\\Windows\\System32\\tar.exe");
        assert.deepEqual(args, ["-xzf", "-", "-C", "D:\\a\\dssh\\dssh\\.cache\\rdp"]);
        assert.deepEqual(options.input, bytes);
        assert.deepEqual(options.stdio, ["pipe", "inherit", "inherit"]);
      },
    });
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real compressed archives extract through stdin, including paths with spaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "dssh archive test "));
  try {
    const source = join(dir, "source"); const destination = join(dir, "destination");
    mkdirSync(source); mkdirSync(destination);
    writeFileSync(join(source, "fixture.txt"), "archive regression fixture");
    const archive = join(dir, "source archive.tar.gz");
    const tar = archiveExtractor(process.platform, process.env.SystemRoot || process.env.SYSTEMROOT);
    const compressed = execFileSync(tar, ["-czf", "-", "-C", source, "fixture.txt"]);
    writeFileSync(archive, compressed);
    extractArchive(archive, destination);
    assert.equal(readFileSync(join(destination, "fixture.txt"), "utf8"), "archive regression fixture");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
