import assert from "node:assert/strict";
import test from "node:test";

import { basicAuth, inspectJwt, jsonToCsv, parseToolUrl } from "./webDataTools.ts";
import {
  binaryToText, changeTextCase, convertList, textStatistics, textToBinary, textToUnicode, unicodeToText,
} from "./textConverters.ts";
import { convertIpv4, expandIpv4Range, radixInteger, randomPort, randomToolToken } from "./networkConverters.ts";
import { findRegexMatches } from "./regexMatch.ts";

test("URL parsing preserves repeated and empty query parameters", () => {
  const parsed = JSON.parse(parseToolUrl("https://demo:example@[::1]:8443/path?tag=dev&tag=qa&empty&lang=%E4%B8%AD#top"));
  assert.deepEqual(parsed, {
    protocol: "https", hostname: "[::1]", port: "8443", pathname: "/path",
    query: [["tag", "dev"], ["tag", "qa"], ["empty", ""], ["lang", "中"]],
    fragment: "top", username: "demo", hasPassword: true,
  });
  assert.throws(() => parseToolUrl("example.org/path"), /完整 URL/);
});

test("JWT inspection decodes Unicode and preserves the original numeric claims", () => {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const payload = Buffer.from('{"sub":"运维","number":9007199254740993}').toString("base64url");
  assert.match(inspectJwt(`${header}.${payload}.AQ`), /"sub": "运维"[\s\S]*9007199254740993[\s\S]*AQ/);
  assert.match(inspectJwt(`${header}.${payload}.`), /签名（Base64URL）\n空/);
  for (const invalid of [`${header}.*.AQ`, `${header}..AQ`, `${header}.${payload}.a`]) {
    assert.throws(() => inspectJwt(invalid), /三段式/);
  }
  assert.throws(() => inspectJwt(`${header}.W10.AQ`), /JSON 对象/);
});

test("Basic Auth encodes user and password as UTF-8, with colons allowed in passwords", () => {
  assert.equal(basicAuth("Aladdin", "open sesame"), "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
  const encoded = basicAuth("运维", "a:b").split(" ").pop();
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "运维:a:b");
  assert.throws(() => basicAuth("dev:qa", ""), /冒号/);
  assert.throws(() => basicAuth("dev", "a\nb"), /控制字符/);
});

test("JSON-to-CSV quotes separators and newlines and fills a consistent set of columns", () => {
  const data = [
    { host: "a,b", note: 'ab"cd', extra: "a\nb", ["__proto__"]: "first" },
    { host: "dev", port: 22, item: { ok: true } },
  ];
  assert.equal(jsonToCsv(JSON.stringify(data)), [
    "host,note,extra,__proto__,port,item",
    '"a,b","ab""cd","a\nb",first,,',
    'dev,,,,22,"{""ok"":true}"',
  ].join("\r\n"));
  for (const input of ["[]", "{}", "[1]", "[[]]", '[{"unsafe":9007199254740993}]']) {
    assert.throws(() => jsonToCsv(input));
  }
  const sparse = Array.from({ length: 400 }, (_, index) => ({ [index]: index }));
  assert.throws(() => jsonToCsv(JSON.stringify(sparse)), /单元格/);
});

test("integer conversion preserves values beyond JavaScript's safe number range", () => {
  assert.equal(radixInteger(" +20000000000001 ", 16), 9007199254740993n);
  assert.equal(radixInteger("-zz", 36), -1295n);
  assert.throws(() => radixInteger("102", 2), /不支持/);
  assert.throws(() => radixInteger("123", 37), /进制/);
});

test("IPv4 conversions and inclusive ranges handle octet carry and the upper boundary", () => {
  assert.equal(convertIpv4("0xFFFFFFFF"), convertIpv4("255.255.255.255"));
  assert.equal(convertIpv4("0b1010"), convertIpv4("10"));
  assert.throws(() => convertIpv4("4294967296"), /介于/);
  assert.throws(() => convertIpv4("0x+1"), /格式/);
  assert.equal(expandIpv4Range("192.168.1.255", "192.168.2.1"), "192.168.1.255\n192.168.2.0\n192.168.2.1");
  assert.equal(expandIpv4Range("255.255.255.255", "255.255.255.255"), "255.255.255.255");
  assert.throws(() => expandIpv4Range("192.168.0.0", "192.169.0.0"), /4096/);
  assert.throws(() => expandIpv4Range("192.168.1.1", "192.168.0.1"), /结束地址/);
});

test("Unicode and binary conversions round-trip UTF-8, supplementary characters and BOMs", () => {
  const input = "\uFEFFSSH 中文🚀\n";
  assert.equal(unicodeToText(textToUnicode(input)), input);
  assert.equal(binaryToText(textToBinary(input)), input);
  assert.equal(textToUnicode("中🚀"), "U+4E2D U+1F680");
  assert.throws(() => unicodeToText("U+D800"), /范围/);
  assert.throws(() => unicodeToText("U+110000"), /范围/);
  assert.throws(() => binaryToText("010001"), /8 位/);
  assert.throws(() => binaryToText("11111111"), /UTF-8/);
});

test("case, list and statistics tools handle acronyms, duplicate entries and line breaks", () => {
  assert.equal(changeTextCase("HTTPServer_端口-22", "snake"), "http_server_端口_22");
  assert.equal(changeTextCase("cli HTTP server", "camel"), "cliHttpServer");
  assert.equal(changeTextCase("hello, world", "pascal"), "HelloWorld");
  assert.equal(convertList(" dev\r\n qa\n\ndev ", "line", "tab", true), "dev\tqa");
  assert.match(textStatistics("a\r\nb 🚀"), /码点　6\n单词　2\n行数　2\nUTF-8 字节　9/);
});

test("regex captures, zero-width Unicode matches and result caps", () => {
  assert.match(findRegexMatches("(Port) (\\d+)", "g", "Port 22 Port 2200"), /共 2 项[\s\S]*"2200"/);
  assert.match(findRegexMatches("(?=.)", "gu", "🚀中"), /共 2 项[\s\S]*"index": 2/);
  assert.match(findRegexMatches("a", "g", "a".repeat(101)), /前 100 项/);
  assert.match(findRegexMatches("a", "", "a".repeat(10)), /共 1 项/);
  assert.equal(findRegexMatches("x", "g", "abc"), "没有匹配项。");
  assert.throws(() => findRegexMatches("[", "", ""), /无效/);
});

test("random generators respect range, length and the URL-safe alphabet", () => {
  assert.match(randomToolToken("32"), /^[A-Za-z0-9_-]{32}$/);
  assert.throws(() => randomToolToken("129"), /128/);
  for (let index = 0; index < 32; index++) {
    const port = Number(randomPort());
    assert.ok(port >= 49152 && port <= 65535);
  }
});
