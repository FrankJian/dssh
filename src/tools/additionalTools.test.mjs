import assert from "node:assert/strict";
import { createHmac, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import test from "node:test";
import jsQR from "jsqr";
import { parse } from "yaml";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import {
  convertToToml, convertToml, jsonToXml, prettifySql, prettifyXml, prettifyYaml, xmlToJson,
} from "./configConversions.ts";
import { markdownToHtml } from "./markdownToHtml.ts";
import { dockerRunToCompose } from "./dockerCompose.ts";
import {
  base32Bytes, bcryptHash, bcryptVerify, decryptToolText, digestText, encryptToolText, generateBip39, hmacText, makeTotp,
} from "./cryptoTools.ts";
import { generateRsaPair } from "./rsaKeys.ts";
import { qrSymbol, wifiQrPayload } from "./qrTools.ts";
import { convertColor, svgPlaceholder } from "./colorTools.ts";
import { asciiArt } from "./asciiArt.ts";
import { formatPhone, inspectIban, inspectUserAgent, lookupHttpStatus, lookupMime } from "./referenceTools.ts";
import {
  buildCron, calculateEta, calculateExpression, calculatePercentage, convertRoman, convertTemperature,
  decodeSafeLink, generateIpv6Ula, generateUlid, htmlEntities, normalizeEmail, randomMacAddress, slugifyText,
} from "./utilityTools.ts";
import { maskText, openGraphTags, searchMemo } from "./advancedReferenceTools.ts";

test("TOML forwards nested arrays and dates explicitly and rejects data it cannot represent", () => {
  const input = '{"server":{"host":"localhost","ports":[22,443]},"enabled":true}';
  assert.deepEqual(JSON.parse(convertToml(convertToToml(input, "json"), "json")), JSON.parse(input));
  assert.deepEqual(parse(convertToml(convertToToml("host: demo\nport: 22", "yaml"), "yaml")), { host: "demo", port: 22 });
  const date = JSON.parse(convertToml("date = 2026-02-01T10:00:00.123456+08:00\nlocal = 07:32:00", "json"));
  assert.deepEqual(date, { date: "2026-02-01T10:00:00.123456+08:00", local: "07:32:00" });
  assert.throws(() => convertToml("date = 2026-02-29", "json"), /invalid date/i);
  assert.throws(() => convertToToml('{"unsupported":null}', "json"), /null/);
  assert.throws(() => convertToml("number = 9007199254740993", "json"), /安全整数/);
  assert.throws(() => convertToml("number = inf", "yaml"), /非有限/);
});

test("YAML formatting preserves documents, comments, tags and aliases", () => {
  const value = "# docs\nbase: &base {enabled: false}\nref: *base\n---\nhello: !local value";
  const output = prettifyYaml(value);
  assert.match(output, /# docs[\s\S]*&base[\s\S]*\*base[\s\S]*---[\s\S]*!local/);
  assert.throws(() => prettifyYaml("a: 1\na: 2"), /DUPLICATE_KEY/);
});

test("XML round-trips namespaced and mixed content and refuses DTDs and malformed markup", () => {
  const input = '<?xml version="1.0"?><root xmlns:r="urn:test">prefix<r:item id="1"> A &amp; B </r:item><![CDATA[<x>]]><!--ok-->suffix</root>';
  const json = xmlToJson(input);
  assert.deepEqual(JSON.parse(xmlToJson(jsonToXml(json))), JSON.parse(json));
  assert.equal(jsonToXml('{"hosts":{"host":[{"_attributes":{"port":22},"_text":"dev"},"qa"]}}'),
    '<hosts>\n  <host port="22">dev</host>\n  <host>qa</host>\n</hosts>');
  assert.equal(prettifyXml('<root><entry> A &amp; B </entry><empty/></root>'),
    '<root>\n  <entry> A &amp; B </entry>\n  <empty/>\n</root>');
  assert.equal(prettifyXml('<root xml:space="preserve"> <a/>  <b/> </root>'),
    '<root xml:space="preserve"> <a/>  <b/> </root>');
  assert.throws(() => xmlToJson('<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///tmp/data">]><x>&ext;</x>'), /DTD/);
  assert.throws(() => xmlToJson("<a><b></a>"), /语法/);
  assert.throws(() => jsonToXml('{"nodes":[{"name":"x><y"}]}'), /名称/);
});

test("SQL and Markdown preserve literals and treat embedded HTML as text", () => {
  const sql = prettifySql("select 'a;--b', now() from hosts where port>=22;", "postgresql");
  assert.match(sql, /'a;--b'[\s\S]*\n(?:from|FROM)\b/);
  const html = markdownToHtml("# Heading\n\n<strong>raw</strong>\n\n[link](javascript:alert%281%29)");
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /&lt;strong&gt;raw/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("Docker Compose conversion preserves quoting, named volumes and command arguments", () => {
  const compose = parse(dockerRunToCompose(
    `docker run -itd --name=web --network ops -p 8080:80 -v data:/srv:ro -e 'TEXT=ready $ here' --entrypoint sh nginx:alpine -c 'echo hello world'`,
  ));
  assert.deepEqual(compose.networks, { ops: { external: true } });
  assert.deepEqual(compose.volumes, { data: { name: "data" } });
  assert.deepEqual(compose.services.web, {
    image: "nginx:alpine", stdin_open: true, tty: true, container_name: "web", networks: ["ops"], ports: ["8080:80"],
    volumes: ["data:/srv:ro"], environment: ["TEXT=ready $$ here"], entrypoint: ["sh"], command: ["-c", "echo hello world"],
  });
  assert.equal(parse(dockerRunToCompose("docker run alpine")).services.app.network_mode, "bridge");
  for (const input of ["docker run --rm alpine", "docker run alpine && whoami", "docker run $IMAGE", "docker run -p alpine",
    "docker run --network host -p 8080:80 alpine", "docker run --name broken/name alpine"]) {
    assert.throws(() => dockerRunToCompose(input), undefined, input);
  }
});

test("digest and HMAC agree with established vectors and an independent implementation", () => {
  assert.equal(digestText("abc", "md5"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(digestText("abc", "sha256"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const digest of ["sha224", "sha256", "sha384", "sha512"]) {
    const expected = createHmac(digest, "秘钥").update("数据🚀").digest("hex");
    assert.equal(hmacText("数据🚀", "秘钥", digest), expected);
  }
});

test("TOTP matches the RFC 6238 vectors and checks Base32 padding", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const sha256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
  const sha512 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
  assert.equal(makeTotp(secret, 59, 8), "94287082");
  assert.equal(makeTotp(secret, 1_111_111_109, 8), "07081804");
  assert.equal(makeTotp(sha256, 59, 8, "sha256"), "46119246");
  assert.equal(makeTotp(sha512, 59, 8, "sha512"), "90693936");
  assert.deepEqual([...base32Bytes("MY======")], [102]);
  assert.throws(() => base32Bytes("MZ======"), /填充位/);
});

test("bcrypt prevents silent UTF-8 truncation and validates generated hashes", () => {
  const hash = bcryptHash("测试 password 🚀", 4);
  assert.match(hash, /^\$2b\$04\$/);
  assert.equal(bcryptVerify("测试 password 🚀", hash), "密码匹配。");
  assert.equal(bcryptVerify("wrong", hash), "密码不匹配。");
  assert.throws(() => bcryptHash("中".repeat(25), 4), /72/);
  assert.throws(() => bcryptVerify("x", hash.replace("$04$", "$31$")), /成本/);
});

test("AES-GCM uses fresh salt and nonce and authenticates the ciphertext", () => {
  const ciphertext = encryptToolText("测试 data 🚀\n", "local demo password");
  assert.notEqual(ciphertext, encryptToolText("测试 data 🚀\n", "local demo password"));
  assert.equal(decryptToolText(ciphertext, "local demo password"), "测试 data 🚀\n");
  const fields = ciphertext.split(".");
  const altered = Buffer.from(fields[3], "base64");
  altered[0] ^= 1;
  fields[3] = altered.toString("base64");
  assert.throws(() => decryptToolText(fields.join("."), "local demo password"), /无法解密/);
});

test("BIP39 checksums and RSA PEM formats are independently verified", () => {
  for (const count of [12, 24]) {
    const phrase = generateBip39(count);
    assert.equal(phrase.split(" ").length, count);
    assert.ok(validateMnemonic(phrase, wordlist));
  }
  const pem = generateRsaPair();
  const publicKey = createPublicKey(pem.split("\n\n")[0]);
  const privateKey = createPrivateKey(pem.slice(pem.indexOf("-----BEGIN PRIVATE KEY-----")));
  assert.equal(publicKey.asymmetricKeyDetails.modulusLength, 2048);
  const data = Buffer.from("Duo SSH test");
  assert.equal(verify("sha256", data, publicKey, sign("sha256", data, privateKey)), true);
});

function decodeSymbol(text, level = "M") {
  const symbol = qrSymbol(text, level);
  const quiet = 4;
  const scale = 6;
  const size = (symbol.modules.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < symbol.modules.size; row++) {
    for (let col = 0; col < symbol.modules.size; col++) {
      if (!symbol.modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const position = (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) * 4;
          pixels.fill(0, position, position + 3);
        }
      }
    }
  }
  return jsQR(pixels, size, size)?.data;
}

test("QR symbols decode with an independent scanner, including Unicode and Wi-Fi escapes", () => {
  const text = "https://example.org/测试?q=hello&emoji=🚀";
  assert.equal(decodeSymbol(text, "Q"), text);
  const wifi = wifiQrPayload('Cafe; "Wi-Fi"', "pw:a,b\\c", "WPA", true);
  assert.equal(wifi, String.raw`WIFI:T:WPA;S:Cafe\; \"Wi-Fi\";P:pw\:a\,b\\c;H:true;;`);
  assert.equal(decodeSymbol(wifi), wifi);
  assert.equal(wifiQrPayload("Guest", "ignored", "nopass", false), "WIFI:T:nopass;S:Guest;;");
  assert.throws(() => qrSymbol("x".repeat(3000), "M"), /2 KiB/);
  assert.throws(() => qrSymbol("x".repeat(1800), "H"), /容量/);
});

test("decimal arithmetic has exact decimal sums and conventional exponent precedence", () => {
  assert.equal(calculateExpression("0.1 + 0.2"), "0.3");
  assert.equal(calculateExpression("-2**2"), "-4");
  assert.equal(calculateExpression("(-2)**2"), "4");
  assert.equal(calculateExpression("2**3**2"), "512");
  assert.equal(calculateExpression("2**-2"), "0.25");
  assert.throws(() => calculateExpression("1 / 0"), /除以零/);
  assert.throws(() => calculateExpression("2**10001"), /10,000/);
  assert.throws(() => calculateExpression("alert(1)"), /不支持/);
  assert.throws(() => calculateExpression("1 2"), /缺少运算符/);
  assert.equal(calculatePercentage("25", "80", "of"), "20");
  assert.equal(calculatePercentage("-20", "-10", "change"), "50%");
  assert.equal(calculateEta("25", "60"), "预计剩余 180 秒");
  assert.match(convertTemperature("32", "fahrenheit"), /°C  0\n°F  32\nK   273\.15/);
  assert.throws(() => convertTemperature("-1", "kelvin"), /绝对零度/);
});

test("reference utilities check format and preserve unsafe characters as data", () => {
  assert.match(lookupHttpStatus("404"), /404  Not Found/);
  assert.throws(() => lookupHttpStatus("599"), /没有匹配/);
  assert.match(lookupMime("test.json"), /application\/json/);
  assert.match(lookupMime("text/html; charset=utf-8"), /\.html/);
  assert.match(formatPhone("+1 202 555 0123"), /\+12025550123/);
  assert.match(inspectIban("GB82 WEST 1234 5698 7654 32"), /国家或地区  GB/);
  assert.throws(() => inspectIban("GB83WEST12345698765432"), /校验和/);
  assert.match(inspectUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"), /Chrome|Chromium/);
  assert.equal(htmlEntities(htmlEntities("中文 <&>", false), true), "中文 <&>");
  assert.equal(normalizeEmail("Demo.Name+SSH@Gmail.com", true), "demoname@gmail.com");
  assert.equal(normalizeEmail("Demo.Name+SSH@EXAMPLE.ORG", false), "Demo.Name+SSH@example.org");
  assert.equal(slugifyText("Duo SSH Café 工具箱"), "duo-ssh-cafe-工具箱");
  assert.equal(decodeSafeLink("https://x.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org"), "https://example.org");
  assert.throws(() => decodeSafeLink("https://safelinks.protection.outlook.com.attacker.org/?url=https://example.org"), /并非/);
  assert.doesNotMatch(openGraphTags('"><script>alert(1)</script>', "a&b"), /<script>/);
  assert.match(searchMemo("reflog", "git"), /git reflog/);
  assert.equal(maskText("测试\r\n👩‍💻", "all"), "••\r\n•");
});

test("random identifiers, colors and code generators produce valid bounded outputs", () => {
  assert.match(generateUlid(0), /^0{10}[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.match(generateIpv6Ula(), /^fd[0-9a-f]{2}:[0-9a-f]{4}:[0-9a-f]{4}::\/48$/);
  const mac = randomMacAddress();
  assert.equal(Number.parseInt(mac.slice(0, 2), 16) & 3, 2);
  assert.equal(buildCron("07:05", "5,1,1", "weekly"), "5 7 * * 1,5");
  assert.equal(convertRoman("MCMXCIV"), "1994");
  assert.equal(convertRoman("3999"), "MMMCMXCIX");
  assert.throws(() => convertRoman("IIII"), /无效/);
  assert.match(convertColor("hsl(240deg 100% 50% / 50%)"), /^#0000ff80\n/);
  assert.match(convertColor("#0f08"), /^#00ff0088\n/);
  assert.match(svgPlaceholder("640x360", "<script>"), /&lt;script&gt;/);
  assert.match(asciiArt("SSH", "Small"), /\n/);
});
