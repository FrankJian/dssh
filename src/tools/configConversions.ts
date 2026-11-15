import { parse as parseToml, stringify as stringifyToml, TomlDate, type TomlValue } from "smol-toml";
import { parseAllDocuments, stringify as stringifyYaml } from "yaml";
import { format as formatSql, type SqlLanguage } from "sql-formatter";
import { SaxesParser } from "saxes";
import formatXmlSource from "xml-formatter";
import { micromark } from "micromark";
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
  const value = tomlAsJson(parseToml(input, { integersAsBigInt: true, maxDepth: 128 }));
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
  return parseAllDocuments(input, { keepSourceTokens: true }).map((document) => {
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

export function jsonToXml(input: string): string {
  const value = readJsonValue(input);
  if (!xmlObject(value) || !Array.isArray(value.nodes)) {
    throw new Error("请输入 XML 转 JSON 生成的对象结构，顶层需包含 nodes 数组。");
  }
  let declaration = "";
  if (value.declaration !== undefined) {
    if (!xmlObject(value.declaration) || (value.declaration.version !== "1.0" && value.declaration.version !== "1.1")) {
      throw new Error("XML 声明的 version 必须为 1.0 或 1.1。");
    }
    const { version, encoding, standalone } = value.declaration;
    if (encoding !== undefined && (typeof encoding !== "string" || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(encoding))) {
      throw new Error("XML 声明的 encoding 无效。");
    }
    if (standalone !== undefined && standalone !== "yes" && standalone !== "no") throw new Error("standalone 必须是 yes 或 no。");
    declaration = `<?xml version="${version}"${encoding ? ` encoding="${encoding}"` : ""}${standalone ? ` standalone="${standalone}"` : ""}?>\n`;
  }
  const result = declaration + value.nodes.map((node) => xmlNode(node, 0)).join("");
  parseXml(result);
  return result;
}

function contentSensitive(nodes: XmlNode[]): boolean {
  for (const node of nodes) {
    if (typeof node === "object" && "name" in node) {
      const children = node.children ?? [];
      if (node.attributes?.["xml:space"] === "preserve" || children.some((item) =>
        typeof item === "string" ? item.trim().length > 0 || (children.length === 1 && item.length > 0) : "cdata" in item,
      ) || contentSensitive(children)) return true;
    }
  }
  return false;
}

export function prettifyXml(input: string): string {
  const parsed = parseXml(input);
  // Preserve significant character data and xml:space, including nested mixed content.
  if (contentSensitive(parsed.nodes)) return input;
  const result = formatXmlSource(input, { indentation: "  ", strictMode: true, lineSeparator: "\n", collapseContent: true });
  parseXml(result);
  return result;
}

export function markdownToHtml(input: string): string {
  return micromark(input);
}
