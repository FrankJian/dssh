import { decodeBase64, encodeBase64 } from "./base64.ts";
import { ipv4Subnet } from "./networkConverters.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { formatJson, jsonToYaml, yamlToJson } from "./jsonYaml.ts";
import { layoutTextImage, MAX_IMAGE_HEIGHT } from "./textImage.ts";
import {
  compareJson, compareText, convertChmod, convertTimestamp,
  generateUuid, parseCron,
} from "./developerTools.ts";

test("JSON formatting changes only whitespace outside string literals", () => {
  const input = String.raw` { "20" : "\u4e2d \" a" , "2" : 1.50e+01, "integer":9007199254740993, "blank": {} } `;
  const compact = String.raw`{"20":"\u4e2d \" a","2":1.50e+01,"integer":9007199254740993,"blank":{}}`;
  assert.equal(formatJson(input, 0), compact);
  assert.equal(formatJson(input, 2), [
    "{",
    String.raw`  "20": "\u4e2d \" a",`,
    '  "2": 1.50e+01,',
    '  "integer": 9007199254740993,',
    '  "blank": {}',
    "}",
  ].join("\n"));
  assert.equal(formatJson("[[], 1]", 4), "[\n    [],\n    1\n]");
  assert.equal(formatJson(" -0 ", 2), "-0");
  for (const invalid of ["{\n  notJson }", "[1,]", "/* comment */ 1", "01", "1e+"]) {
    assert.throws(() => formatJson(invalid, 2), /第 \d+ 行，第 \d+ 列/);
  }
});

test("YAML round trips JSON-compatible values, including keys with special names", () => {
  const input = '{"__proto__":{"host":"主机"},"on":"yes","text":"a\\nb\\n","list":[1,false,null,{}],"small":0.125}';
  assert.deepEqual(JSON.parse(yamlToJson(jsonToYaml(input))), JSON.parse(input));
  for (const scalar of ["null", "false", "0", '""']) {
    assert.equal(yamlToJson(jsonToYaml(scalar)), scalar);
  }
  assert.equal(yamlToJson("# comment\nname: Duo SSH"), '{\n  "name": "Duo SSH"\n}');
});

test("YAML conversion rejects unsupported documents and unsafe numbers", () => {
  for (const [input, diagnostic] of [
    ["x: 1\nx: 2", /重复键/],
    ["[a, b]: c", /字符串/],
    ["value: !app data", /标签/],
    ["value: !<tag:yaml.org,2002:timestamp> 2026-01-01", /标签|无法转换/],
    ["first: &value hi\nsecond: *value", /别名/],
    ["---\none\n---\ntwo", /一个 YAML 文档/],
    ["value: 9007199254740993", /范围/],
    ["value: .inf", /范围/],
  ]) {
    assert.throws(() => yamlToJson(input), diagnostic, input);
  }
  for (const input of ["9007199254740992", "1e400"]) {
    assert.throws(() => jsonToYaml(input), /范围/);
  }
  assert.throws(() => jsonToYaml('{"x":1,"x":2}'), /重复键/);
});

test("text image layout keeps empty lines and wraps without splitting graphemes", () => {
  const measure = (line) => [...line].length * 10;
  assert.deepEqual(layoutTextImage("  demo\r\n\r\n\tok\n", measure).lines, ["  demo", "", "    ok", ""]);
  const emoji = "👩‍💻";
  const wrapped = layoutTextImage("x".repeat(96) + emoji, measure);
  assert.deepEqual(wrapped.lines, ["x".repeat(96), emoji]);
  assert.ok(wrapped.width <= 1024);
  const lines = Array(168).fill("a");
  assert.ok(layoutTextImage(lines.join("\n"), measure).height <= MAX_IMAGE_HEIGHT);
  assert.throws(() => layoutTextImage([...lines, "a"].join("\n"), measure), /高度/);
  assert.throws(() => layoutTextImage("x".repeat(65537), measure), /过长/);
});

test("encoding and timestamp handle Unicode text and explicit times", () => {
  const text = "\ufeff配置 → Duo SSH 💻";
  assert.equal(decodeBase64(encodeBase64(text)), text);
  assert.throws(() => decodeBase64("???"), /Base64/);
  assert.throws(() => decodeBase64("/w=="), /UTF-8/);
  assert.match(convertTimestamp("1970-01-01T08:00:01+08:00"), /1970-01-01T00:00:01\.000Z/);
  assert.match(convertTimestamp("1700000000123"), /1700000000\.123/);
  assert.throws(() => convertTimestamp("2026-02-31T00:00:00Z"), /日期/);

});

test("generated identifiers use UUID v4 version and variant bits", () => {
  const pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const uuid = generateUuid();
  assert.match(uuid, pattern);
  assert.notEqual(uuid, generateUuid());
});

test("text comparison marks edits and JSON comparison ignores object order", () => {
  const diff = compareText("one\ntwo\n", "one\nthree\n");
  assert.match(diff, /-two\n\+three/);
  assert.equal(compareJson('{"a":1,"b":[1,2]}', '{"b":[1,2],"a":1}'), "内容相同。");
  assert.notEqual(compareJson("[1,2]", "[2,1]"), "内容相同。");
});

test("subnet, chmod and cron handle boundary values and invalid input", () => {
  assert.match(ipv4Subnet("192.168.1.10/0"), /0\.0\.0\.0\/0[\s\S]*255\.255\.255\.255[\s\S]*4294967296/);
  assert.match(ipv4Subnet("192.168.1.10/32"), /192\.168\.1\.10 – 192\.168\.1\.10/);
  assert.match(ipv4Subnet("192.168.1.11/31"), /192\.168\.1\.10 – 192\.168\.1\.11/);
  assert.throws(() => ipv4Subnet("256.0.0.0/8"), /无效/);
  assert.equal(convertChmod("755"), "755\nrwxr-xr-x");
  assert.equal(convertChmod("rw-------"), "600\nrw-------");
  assert.throws(() => convertChmod("999"), /八进制/);
  const now = new Date("2026-02-02T00:00:00Z");
  assert.match(parseCron("0 9 * * MON-FRI", "UTC", now), /09:00:00/);
  assert.throws(() => parseCron("0 0 9 * * *", "UTC", now), /五字段/);
  assert.throws(() => parseCron("61 * * * *", "UTC", now), /无效/);
});
