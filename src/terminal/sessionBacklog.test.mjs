import test from "node:test";
import assert from "node:assert/strict";
import { appendToBacklog, createBacklog, readBacklog } from "./sessionBacklog.ts";
import { RETAINED_OUTPUT_CHARS as limit } from "../settings/settings.ts";

test("reading history does not change eviction granularity", () => {
  const backlog = createBacklog();
  const chunk = "中😀\x1b[31m".repeat(200);
  for (let index = 0; index < 500; index++) {
    appendToBacklog(backlog, chunk);
    assert.equal(readBacklog(backlog), chunk.repeat(backlog.length / chunk.length));
    assert.ok(backlog.length < limit + chunk.length);
  }
});

test("small chunks compact without losing order or retaining evicted strings", () => {
  const backlog = createBacklog();
  for (let index = 0; index < limit * 3; index++) appendToBacklog(backlog, String(index % 10));
  assert.equal(backlog.length, limit);
  assert.equal(readBacklog(backlog), "0123456789".repeat(limit / 10));
  assert.ok(backlog.chunks.length < limit * 2 + 1024);
  assert.ok(backlog.chunks.slice(0, backlog.head).every((chunk) => chunk === ""));
});

test("empty writes and oversized chunks preserve whole input", () => {
  const initial = "x".repeat(limit + 1);
  const backlog = createBacklog(initial);
  appendToBacklog(backlog, "");
  assert.equal(readBacklog(backlog), initial);
  appendToBacklog(backlog, "z".repeat(limit));
  assert.equal(readBacklog(backlog), "z".repeat(limit));
});
