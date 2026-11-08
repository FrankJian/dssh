import assert from "node:assert/strict";
import test from "node:test";
import {
  addressText,
  fileNameKey,
  isLocalRoot,
  isRemoteRoot,
  joinLocal,
  joinLocalChild,
  localParent,
  navigationInputAfterFailure,
  remoteParent,
  resolveLocalAddress,
  resolveRemoteAddress,
} from "./browserPaths.ts";
const windows = { windows: true, home: "C:\\Users\\Demo User" };
const posix = { windows: false, home: "/Users/demo" };

test("drive roots, forward slashes and UNC share roots do not escape their volume", () => {
  for (const path of [
    "C:\\",
    "C:/",
    "C:",
    "\\\\server\\share",
    "\\\\server\\share\\",
    "\\\\?\\C:\\",
    "\\\\?\\UNC\\server\\share\\",
  ]) {
    assert.equal(isLocalRoot(path), true, path);
    assert.equal(isLocalRoot(localParent(path)), true, path);
  }
  assert.equal(localParent("C:\\Users\\demo"), "C:\\Users");
  assert.equal(localParent("C:/Users"), "C:\\");
  assert.equal(localParent("\\\\server\\share\\folder"), "\\\\server\\share\\");
  assert.equal(
    localParent("\\\\?\\UNC\\server\\share\\folder"),
    "\\\\?\\UNC\\server\\share\\",
  );
  assert.equal(localParent("/tmp/a\\b"), "/tmp");
  assert.equal(joinLocal("/tmp/a\\b", "child"), "/tmp/a\\b/child");
  assert.equal(isLocalRoot("/"), true);
  assert.equal(isLocalRoot("/tmp"), false);
});
test("Windows manual input is resolved against the pane, never the application cwd", () => {
  assert.equal(
    resolveLocalAddress("..", "D:\\work\\project", windows),
    "D:\\work\\project\\..",
  );
  assert.equal(
    resolveLocalAddress("src/assets", "D:\\work", windows),
    "D:\\work\\src\\assets",
  );
  assert.equal(
    resolveLocalAddress("\\Windows", "C:\\Users\\demo", windows),
    "C:\\Windows",
  );
  assert.equal(
    resolveLocalAddress("/folder", "\\\\server\\share\\deep", windows),
    "\\\\server\\share\\folder",
  );
  assert.equal(resolveLocalAddress("E:", "C:\\Users", windows), "E:\\");
  assert.equal(
    resolveLocalAddress('"C:\\Program Files\\Open SSH"', "D:\\", windows),
    "C:\\Program Files\\Open SSH",
  );
  assert.equal(
    resolveLocalAddress("C:/Users/demo", "D:\\", windows),
    "C:\\Users\\demo",
  );
  assert.equal(
    resolveLocalAddress("~/Downloads", "D:\\work", windows),
    "C:\\Users\\Demo User\\Downloads",
  );
  assert.throws(
    () => resolveLocalAddress("C:folder", "D:\\", windows),
    /完整盘符/,
  );
  assert.throws(
    () => resolveLocalAddress("\\\\server", "D:\\", windows),
    /完整/,
  );
});
test("file URLs support spaces, Unicode, UNC and localhost without accepting encoded separators", () => {
  assert.equal(
    resolveLocalAddress(
      "file:///C:/Users/Demo%20User/%E6%96%87%E6%A1%A3",
      "D:\\",
      windows,
    ),
    "C:\\Users\\Demo User\\文档",
  );
  assert.equal(
    resolveLocalAddress("file://server/share/My%20Files", "C:\\", windows),
    "\\\\server\\share\\My Files",
  );
  assert.equal(
    resolveLocalAddress(
      "file://localhost/tmp/My%20Files",
      "/Users/demo",
      posix,
    ),
    "/tmp/My Files",
  );
  for (const value of [
    "file:///C:/one%2Ftwo",
    "file:///C:/one%5Ctwo",
    "file:///C:/test#fragment",
    "file:///C:/%00",
    "file:///C:/bad%ZZ",
  ])
    assert.throws(() => resolveLocalAddress(value, "C:\\", windows));
});
test("POSIX paths and remote SFTP paths keep literal backslashes and resolve relative navigation", () => {
  assert.equal(
    resolveLocalAddress("../work", "/Users/demo", posix),
    "/Users/demo/../work",
  );
  assert.equal(
    resolveLocalAddress("~/Downloads", "/tmp", posix),
    "/Users/demo/Downloads",
  );
  assert.equal(resolveLocalAddress("/tmp/a\\b", "/tmp", posix), "/tmp/a\\b");
  assert.equal(resolveRemoteAddress("../logs", "/srv/app"), "/srv/app/../logs");
  assert.equal(
    resolveRemoteAddress("config\\name", "/srv/app"),
    "/srv/app/config\\name",
  );
  assert.equal(
    resolveRemoteAddress("~/logs", "/srv", "/home/demo"),
    "/home/demo/logs",
  );
  assert.equal(remoteParent("/srv/app"), "/srv");
  assert.throws(() => resolveRemoteAddress("file:///C:/Users", "/srv"));
  assert.equal(addressText('"/tmp/folder "'), "/tmp/folder ");
});
test("navigation failures restore only the submitted input, preserving newer edits", () => {
  assert.equal(
    navigationInputAfterFailure("C:\\missing", "C:\\missing", "D:\\work"),
    "D:\\work",
  );
  assert.equal(
    navigationInputAfterFailure("E:\\new-input", "C:\\missing", "D:\\work"),
    "E:\\new-input",
  );
});
test("download child names cannot change the Windows destination or alias an existing filename", () => {
  assert.equal(joinLocalChild("C:\\", "a.txt"), "C:\\a.txt");
  assert.equal(
    joinLocalChild("\\\\server\\share", "a.txt"),
    "\\\\server\\share\\a.txt",
  );
  assert.equal(joinLocalChild("/tmp", "a\\b"), "/tmp/a\\b");
  for (const name of [
    "..",
    "a/b",
    "..\\escape",
    "C:stream",
    "file:ads",
    "name.",
    "name ",
    "CON.txt",
    "COM1",
    "LPT².txt",
  ])
    assert.throws(() => joinLocalChild("D:\\downloads", name), name);
});

test("Windows destination conflict keys are case insensitive without changing remote SFTP names", () => {
  assert.equal(
    fileNameKey("Report.TXT", true),
    fileNameKey("report.txt", true),
  );
  assert.notEqual(
    fileNameKey("Report.TXT", false),
    fileNameKey("report.txt", false),
  );
});

test("Windows SFTP servers keep forward-slash drive paths separate from local Windows syntax", () => {
  assert.equal(
    resolveRemoteAddress("C:/Users/demo", "/home/demo"),
    "C:/Users/demo",
  );
  assert.equal(remoteParent("C:/Users"), "C:/");
  assert.equal(remoteParent("/C:/Users"), "/C:/");
  assert.equal(remoteParent("/C:/"), "/C:/");
  assert.equal(isRemoteRoot("C:/"), true);
  assert.equal(isRemoteRoot("/C:/"), true);
  assert.equal(isRemoteRoot("/C:/Users"), false);
});
