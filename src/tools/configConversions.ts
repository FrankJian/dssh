import { parse as parseToml, stringify as stringifyToml, TomlDate, type TomlValue } from "smol-toml";
import { parseTOML } from "toml-eslint-parser";
import { parseAllDocuments, stringify as stringifyYaml } from "yaml";
import { format as formatSql, type SqlLanguage } from "sql-formatter";
import { SaxesParser } from "saxes";
import { readJsonValue, yamlToJson } from "./jsonYaml.ts";

type JsonValue = ReturnType<typeof readJsonValue>;

function tomlAsJson(value: TomlValue): JsonValue {
  if (value instanceof TomlDate) return value.toISOString();
  if (typeof value === "bigint" || typeof value === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) {
      throw new Error("TOML 含有非有限数字或超出安全整数范围的值。");
    }
    return number;
  }
  if (Array.isArray(value)) return value.map(tomlAsJson);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tomlAsJson(item)]));
  }
  return value;
}

export function convertToml(input: string, output: "json" | "yaml"): string {
  // Preserve temporal literals, including fractional seconds and the original offset.
  // The token parser also validates calendar dates before the JavaScript Date fallback can roll them over.
  const { tokens } = parseTOML(input, { tomlVersion: "1.1" });
  const pieces: string[] = [];
  let previous = 0;
  for (const token of tokens) {
    if (token.type !== "OffsetDateTime" && token.type !== "LocalDateTime" &&
        token.type !== "LocalDate" && token.type !== "LocalTime") continue;
    const [start, end] = token.range;
    pieces.push(input.slice(previous, start), JSON.stringify(token.value));
    previous = end;
  }
  pieces.push(input.slice(previous));
  const value = tomlAsJson(parseToml(pieces.join(""), { integersAsBigInt: true, maxDepth: 128 }));
  return output === "json" ? JSON.stringify(value, null, 2) : stringifyYaml(value);
}

function jsonAsToml(value: JsonValue): TomlValue {
  if (value === null) throw new Error("TOML 不支持 null。");
  if (Array.isArray(value)) return value.map(jsonAsToml);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonAsToml(item)]));
  }
  return value;
}

export function convertToToml(input: string, from: "json" | "yaml"): string {
  const value: JsonValue = from === "json" ? readJsonValue(input) : JSON.parse(yamlToJson(input));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TOML 的顶层必须是对象。");
  }
  return stringifyToml(jsonAsToml(value));
}

export function prettifyYaml(input: string): string {
  if (!input.trim()) throw new Error("请输入 YAML。");
  return parseAllDocuments(input).map((document) => {
    if (document.errors.length) throw new Error(`YAML 解析失败（${document.errors[0].code}）。`);
    return document.toString({ indent: 2, lineWidth: 0 });
  }).map((part, index) => index === 0 || /^---(?:\s|$)|^%/.test(part) ? part : `---\n${part}`).join("");
}

export function prettifySql(input: string, language: SqlLanguage): string {
  if (!input.trim()) throw new Error("请输入 SQL。");
  return formatSql(input, { language, tabWidth: 2 });
}

type XmlElement = { name: string; attributes?: Record<string, string>; children?: XmlNode[] };
type XmlNode = XmlElement | string | { cdata: string } | { comment: string } | { pi: { target: string; body: string } };

function parseXml(input: string) {
  const parser = new SaxesParser({ xmlns: true });
  const document: XmlNode[] = [];
  const stack: XmlElement[] = [];
  let declaration: { version?: string; encoding?: string; standalone?: string } | undefined;
  function add(node: XmlNode) {
    const parent = stack[stack.length - 1];
    if (parent) (parent.children ??= []).push(node);
    else if (typeof node !== "string" || node.trim()) document.push(node);
  }
  parser.on("error", () => { throw new Error(`XML 第 ${parser.line} 行、第 ${parser.column} 列语法无效。`); });
  parser.on("doctype", () => { throw new Error("此工具仅处理不含 DTD 的 XML。"); });
  parser.on("xmldecl", (value) => { declaration = value; });
  parser.on("opentag", ({ name, attributes }) => {
    if (stack.length === 128) throw new Error("XML 最多支持 128 层嵌套。");
    const element: XmlElement = { name };
    if (Object.keys(attributes).length) {
      element.attributes = Object.fromEntries(Object.values(attributes).map((attribute) => [attribute.name, attribute.value]));
    }
    add(element);
    stack.push(element);
  });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("text", add);
  parser.on("cdata", (cdata) => add({ cdata }));
  parser.on("comment", (comment) => add({ comment }));
  parser.on("processinginstruction", (pi) => add({ pi }));
  parser.write(input).close();
  return { ...(declaration ? { declaration } : {}), nodes: document };
}

export function xmlToJson(input: string): string {
  return JSON.stringify(parseXml(input), null, 2);
}

function xmlText(value: string, attribute = false): string {
  const escaped = value.replace(/[&<>]/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
  return attribute ? escaped.replace(/["\t\r\n]/g, (character) =>
    character === '"' ? "&quot;" : `&#${character.charCodeAt(0)};`,
  ) : escaped.replace(/\r/g, "&#13;");
}

function xmlObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function xmlNode(value: JsonValue, depth: number): string {
  if (depth > 128) throw new Error("XML 最多支持 128 层嵌套。");
  if (typeof value === "string") return xmlText(value);
  if (xmlObject(value)) {
    if (typeof value.name === "string") {
      let attributes = "";
      if (value.attributes !== undefined) {
        if (!xmlObject(value.attributes)) throw new Error("attributes 必须是对象。");
        for (const [name, item] of Object.entries(value.attributes)) {
          if (typeof item !== "string") throw new Error("XML 属性值必须为字符串。");
          attributes += ` ${xmlName(name)}="${xmlText(item, true)}"`;
        }
      }
      const tag = xmlName(value.name);
      if (value.children === undefined) return `<${tag}${attributes}/>`;
      if (!Array.isArray(value.children)) throw new Error("children 必须是数组。");
      return `<${tag}${attributes}>${value.children.map((child) => xmlNode(child, depth + 1)).join("")}</${tag}>`;
    }
    if (typeof value.cdata === "string") return `<![CDATA[${value.cdata.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
    if (typeof value.comment === "string" && !value.comment.includes("--") && !value.comment.endsWith("-")) {
      return `<!--${value.comment}-->`;
    }
    if (xmlObject(value.pi) && typeof value.pi.target === "string" && typeof value.pi.body === "string"
        && !value.pi.body.includes("?>")) {
      return `<?${xmlName(value.pi.target)} ${value.pi.body}?>`;
    }
  }
  throw new Error("XML 节点必须是文本或具有 name、comment、cdata 或 pi 的对象。");
}

function xmlName(value: string): string {
  // The namespace-aware parser performs the complete XML name validation on the result.
  if (!value || /[\s="'<>/&?]/u.test(value)) throw new Error("XML 名称无效。");
  return value;
}

function scalarXmlText(value: JsonValue): string {
  if (value === null || typeof value === "object") throw new Error("XML 文本与属性须使用字符串、数字或布尔值。");
  return String(value);
}

function namedXmlNode(name: string, value: JsonValue, depth: number): XmlElement {
  if (depth > 128) throw new Error("XML 最多支持 128 层嵌套。");
  if (value === null) return { name };
  if (!xmlObject(value)) return { name, children: [scalarXmlText(value)] };

  const result: XmlElement = { name };
  for (const [key, child] of Object.entries(value)) {
    if (key === "_attributes") {
      if (!xmlObject(child)) throw new Error("_attributes 必须是对象。");
      result.attributes = Object.fromEntries(Object.entries(child).map(([attribute, data]) => [attribute, scalarXmlText(data)]));
    } else if (key === "_text") {
      (result.children ??= []).push(scalarXmlText(child));
    } else if (key === "_cdata") {
      if (typeof child !== "string") throw new Error("_cdata 必须是字符串。");
      (result.children ??= []).push({ cdata: child });
    } else {
      const values = Array.isArray(child) ? child : [child];
      for (const item of values) (result.children ??= []).push(namedXmlNode(key, item, depth + 1));
    }
  }
  return result;
}

export function jsonToXml(input: string): string {
  const value = readJsonValue(input);
  if (!xmlObject(value)) throw new Error("JSON 顶层须为对象。");
  const keys = Object.keys(value);
  let result: string;
  if (Array.isArray(value.nodes) && keys.every((key) => key === "nodes" || key === "declaration")) {
    result = xmlDeclaration(value.declaration) + value.nodes.map((node) => xmlNode(node, 0)).join("");
  } else {
    if (keys.length !== 1) throw new Error("JSON 对象需要一个 XML 根元素。");
    result = formatXmlNode(namedXmlNode(keys[0], value[keys[0]], 0), 0);
  }
  parseXml(result);
  return result;
}

function xmlDeclaration(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  if (!xmlObject(value) || (value.version !== "1.0" && value.version !== "1.1")) {
    throw new Error("XML 声明的 version 必须为 1.0 或 1.1。");
  }
  const { version, encoding, standalone } = value;
  if (encoding !== undefined && (typeof encoding !== "string" || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(encoding))) {
    throw new Error("XML 声明的 encoding 无效。");
  }
  if (standalone !== undefined && standalone !== "yes" && standalone !== "no") throw new Error("standalone 必须是 yes 或 no。");
  return `<?xml version="${version}"${encoding ? ` encoding="${encoding}"` : ""}${standalone ? ` standalone="${standalone}"` : ""}?>\n`;
}

function formatXmlNode(node: XmlNode, depth: number): string {
  const indent = "  ".repeat(depth);
  if (typeof node !== "object" || !("name" in node) || !node.children?.length) {
    return indent + xmlNode(node, depth);
  }
  const children = node.children;
  const hasSignificantText = children.some((item) => typeof item === "string" ? Boolean(item.trim()) : "cdata" in item);
  const hasElements = children.some((item) => typeof item === "object" && "name" in item);
  if (node.attributes?.["xml:space"] === "preserve" || hasSignificantText || !hasElements) {
    return indent + xmlNode(node, depth);
  }
  const opening = xmlNode({ name: node.name, ...(node.attributes ? { attributes: node.attributes } : {}) }, depth).slice(0, -2) + ">";
  const nested = children.filter((item) => typeof item !== "string").map((item) => formatXmlNode(item, depth + 1));
  return [indent + opening, ...nested, `${indent}</${node.name}>`].join("\n");
}

export function prettifyXml(input: string): string {
  const { declaration, nodes } = parseXml(input);
  const result = xmlDeclaration(declaration ? Object.fromEntries(Object.entries(declaration)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined)
    + nodes.map((node) => formatXmlNode(node, 0)).join("\n");
  return result;
}
