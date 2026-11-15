import { parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import { isMap, isScalar, isSeq, parseDocument, stringify, type Node as YamlNode } from "yaml";

function errorAt(input: string, offset: number, message: string): Error {
  const lines = input.slice(0, offset).split(/\r\n|\r|\n/);
  return new Error(`第 ${lines.length} 行，第 ${lines[lines.length - 1].length + 1} 列：${message}`);
}

function jsonTokens(input: string): IterableIterator<RegExpMatchArray> {
  return input.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g);
}

export function readJsonTree(input: string): Node {
  let depth = 0;
  for (const [token] of jsonTokens(input)) {
    if (token === "{" || token === "[") depth++;
    if (token === "}" || token === "]") depth--;
    if (depth > 128) throw new Error("JSON 嵌套过深，最多支持 128 层。");
  }
  const errors: ParseError[] = [];
  const root = parseTree(input, errors, { disallowComments: true });
  const error = errors[0];
  if (error) throw errorAt(input, error.offset, `JSON 语法错误（${printParseErrorCode(error.error)}）。`);
  if (!root) throw new Error("请输入 JSON。");
  try {
    JSON.parse(input);
  } catch {
    throw errorAt(input, 0, "请输入严格 JSON 格式。");
  }
  return root;
}

export function formatJson(input: string, indent: 0 | 2 | 4): string {
  readJsonTree(input);
  const output: string[] = [];
  let depth = 0;
  let previous = "";
  const newLine = () => "\n" + " ".repeat(depth * indent);
  for (const [token] of jsonTokens(input)) {
    const opening = token === "{" || token === "[";
    const closing = token === "}" || token === "]";
    const previousOpening = previous === "{" || previous === "[";
    if (closing) depth--;
    if (indent && ((previousOpening && !closing) || previous === "," || (closing && !previousOpening))) {
      output.push(newLine());
    } else if (indent && previous === ":") {
      output.push(" ");
    }
    output.push(token);
    if (opening) depth++;
    previous = token;
  }
  return output.join("");
}

function safeNumber(number: number): number {
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) {
    throw new Error("数字超出可安全转换的范围。");
  }
  return number;
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

function jsonValue(node: Node): JsonValue {
  if (node.type === "number") return safeNumber(node.value);
  if (node.type === "array") return (node.children ?? []).map(jsonValue);
  if (node.type === "object") {
    const properties = new Map<string, JsonValue>();
    for (const property of node.children ?? []) {
      const [key, value] = property.children!;
      if (properties.has(key.value)) throw new Error("JSON 包含重复键。");
      properties.set(key.value, jsonValue(value));
    }
    return Object.fromEntries(properties);
  }
  return node.value;
}

export function readJsonValue(input: string): JsonValue {
  return jsonValue(readJsonTree(input));
}

function yamlValue(node: YamlNode | null, depth = 0): JsonValue {
  if (depth > 128) throw new Error("YAML 嵌套过深，最多支持 128 层。");
  if (node === null) return null;
  if ("tag" in node && node.tag && !node.tag.startsWith("tag:yaml.org,2002:")) {
    throw new Error("YAML 含有自定义标签。");
  }
  if (isMap<YamlNode, YamlNode>(node)) {
    return Object.fromEntries(node.items.map(({ key, value }) => {
      if (!isScalar(key) || typeof key.value !== "string") {
        throw new Error("YAML 映射键必须是字符串。");
      }
      return [key.value, yamlValue(value ?? null, depth + 1)];
    }));
  }
  if (isSeq<YamlNode>(node)) return node.items.map((item) => yamlValue(item, depth + 1));
  if (!isScalar(node)) throw new Error("YAML 别名无法转换。");
  const value = node.value;
  if (typeof value === "number" || typeof value === "bigint") return safeNumber(Number(value));
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  throw new Error("YAML 值无法转换为 JSON。");
}

export function jsonToYaml(input: string): string {
  return stringify(readJsonValue(input), { version: "1.2" });
}

export function yamlToJson(input: string): string {
  if (!input.trim()) throw new Error("请输入 YAML。");
  const document = parseDocument(input, { version: "1.2", schema: "core", intAsBigInt: true });
  if (document.directives.yaml.version !== "1.2") throw new Error("请输入 YAML 1.2 文档。");
  const error = document.errors[0] ?? document.warnings[0];
  if (error) {
    const label = error.code === "MULTIPLE_DOCS" ? "仅支持一个 YAML 文档。"
      : error.code === "DUPLICATE_KEY" ? "YAML 包含重复键。"
      : error.code === "TAG_RESOLVE_FAILED" ? "YAML 含有不支持的标签。"
      : `YAML 语法错误（${error.code}）。`;
    throw errorAt(input, error.pos[0], label);
  }
  return JSON.stringify(yamlValue(document.contents), null, 2);
}
