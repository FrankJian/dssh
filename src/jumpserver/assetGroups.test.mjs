import test from "node:test";
import assert from "node:assert/strict";
import { groupJumpServerAssets } from "./assetGroups.ts";
const asset = (id, nodeIds) => ({ id, name: id, address: "10.0.0.1", nodeIds, active: true });
const nodes = [
  { id: "n2", name: "测试", key: "2" },
  { id: "n1", name: "生产", key: "1" },
];
test("directory groups preserve multiple memberships without duplicate rows", () => {
  const groups = groupJumpServerAssets([asset("shared", ["n2", "n1", "n1"]), asset("prod", ["n1"])], nodes);
  assert.deepEqual(groups.map((g) => g.label), ["生产", "测试"]);
  assert.deepEqual(groups[0].assets.map((a) => a.id), ["shared", "prod"]);
  assert.deepEqual(groups[1].assets.map((a) => a.id), ["shared"]);
});
test("unloaded nodes and missing metadata are distinct and do not invent membership", () => {
  const groups = groupJumpServerAssets([asset("unknown", ["not-loaded", "another"]), asset("missing", [])], nodes);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.key === "unloaded-directories").assets.map((a) => a.id), ["unknown"]);
  assert.deepEqual(groups.find((g) => g.key === "missing-directory").assets.map((a) => a.id), ["missing"]);
});
test("only assets on the supplied page are grouped, and newly loaded nodes resolve labels", () => {
  assert.deepEqual(groupJumpServerAssets([], nodes), []);
  const page = [asset("current-page", ["n3"])];
  assert.equal(groupJumpServerAssets(page, nodes)[0].key, "unloaded-directories");
  assert.equal(groupJumpServerAssets(page, [...nodes, { id: "n3", name: "研发", key: "3" }])[0].label, "研发");
  assert.deepEqual(page[0].nodeIds, ["n3"]);
});
