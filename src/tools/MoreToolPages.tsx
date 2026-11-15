import { useState } from "react";
import { SettingsSwitch } from "../ui/SettingsSwitch";
import { ToolSelect } from "./ToolControls";
import { TextTool } from "./ToolForm";
import { basicAuth, inspectJwt, jsonToCsv, parseToolUrl } from "./webDataTools";
import {
  binaryToText, changeTextCase, convertList, textStatistics, textToBinary, textToUnicode, unicodeToText,
} from "./textConverters";
import { convertIpv4, expandIpv4Range, radixInteger, randomPort, randomToolToken } from "./networkConverters";

export function UrlParserTool() {
  return (
    <TextTool action="解析" inputType="text" inputLabel="完整 URL" outputLabel="URL 组成"
      example="https://example.org:8443/api?tag=dev&tag=ssh#results" run={parseToolUrl} />
  );
}

export function JwtTool() {
  return (
    <>
      <p className="tool-form__note">仅解码三段式令牌。签名和声明的有效性需由服务端验证。</p>
      <TextTool action="解码" inputLabel="JWT" outputLabel="解码结果"
        example="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJkZW1vIiwicm9sZSI6InJlYWRlciJ9."
        run={inspectJwt} />
    </>
  );
}

export function BasicAuthTool() {
  return (
    <TextTool action="生成请求头" inputType="text" inputLabel="用户名" outputLabel="Authorization 请求头"
      example="Aladdin" secondInput={{ label: "密码", example: "open sesame", type: "password" }}
      run={basicAuth} />
  );
}

export function JsonCsvTool() {
  return (
    <TextTool action="转换" inputLabel="JSON 对象数组" outputLabel="CSV"
      example={'[{"host":"dev","port":22},{"host":"qa","port":2200}]'} run={jsonToCsv} />
  );
}

export function Ipv4ConvertTool() {
  return (
    <TextTool action="换算" inputType="text" inputLabel="IPv4、十进制整数、0x 十六进制或 0b 二进制"
      outputLabel="地址表示" example="192.168.1.10" run={convertIpv4} />
  );
}

export function Ipv4RangeTool() {
  return (
    <TextTool action="展开范围" inputType="text" inputLabel="起始 IPv4 地址" outputLabel="IPv4 地址列表"
      example="192.168.1.10" secondInput={{ label: "结束 IPv4 地址", example: "192.168.1.14", type: "text" }}
      run={expandIpv4Range} />
  );
}

const BASES = Array.from({ length: 35 }, (_, index) => {
  const value = String(index + 2);
  return { value, label: value };
});

export function RadixTool() {
  const [from, setFrom] = useState(10);
  const [to, setTo] = useState(16);
  return (
    <TextTool action="换算" inputType="text" inputLabel="整数（无需进制前缀）" outputLabel="换算结果"
      example={from === 2 ? "101" : "1010"} resultKey={`${from}:${to}`}
      options={
        <>
          <ToolSelect label="输入进制" value={String(from)} onChange={(value) => setFrom(Number(value))} options={BASES} searchable />
          <ToolSelect label="输出进制" value={String(to)} onChange={(value) => setTo(Number(value))} options={BASES} searchable />
        </>
      }
      run={(input) => radixInteger(input, from).toString(to)}
    />
  );
}

function TextCodeTool({ target, example, encode, decode }: {
  target: string;
  example: string;
  encode: (input: string) => string;
  decode: (input: string) => string;
}) {
  const [reverse, setReverse] = useState(false);
  return (
    <TextTool action="转换" inputLabel={reverse ? target : "文本"} outputLabel={reverse ? "文本" : target}
      example={reverse ? encode(example) : example} resultKey={Number(reverse)} run={reverse ? decode : encode}
      options={
        <ToolSelect label="转换方向" value={reverse ? "decode" : "encode"}
          onChange={(value) => setReverse(value === "decode")}
          options={[{ value: "encode", label: `文本 → ${target}` }, { value: "decode", label: `${target} → 文本` }]} />
      }
    />
  );
}

export function UnicodeTool() {
  return <TextCodeTool target="Unicode 码点" example="Duo SSH 中文🚀" encode={textToUnicode} decode={unicodeToText} />;
}

export function BinaryTool() {
  return <TextCodeTool target="UTF-8 二进制" example="SSH 中文" encode={textToBinary} decode={binaryToText} />;
}

type TextCase = Parameters<typeof changeTextCase>[1];
const CASES: Record<TextCase, string> = {
  upper: "大写", lower: "小写", camel: "camelCase", pascal: "PascalCase",
  snake: "snake_case", kebab: "kebab-case",
};

export function TextCaseTool() {
  const [mode, setMode] = useState<TextCase>("snake");
  return (
    <TextTool action="转换" inputLabel="原始文本" outputLabel="转换结果" example="HTTPServerPort"
      resultKey={mode} run={(input) => changeTextCase(input, mode)}
      options={
        <ToolSelect label="输出格式" value={mode} onChange={(value) => setMode(value as TextCase)}
          options={Object.entries(CASES).map(([value, label]) => ({ value, label }))} />
      }
    />
  );
}

export function TextStatisticsTool() {
  return (
    <TextTool action="统计" inputLabel="文本" outputLabel="统计结果"
      example={"Duo SSH 工具箱\nHost dev"} run={textStatistics} />
  );
}

type ListSeparator = Parameters<typeof convertList>[1];

function SeparatorSelect({ label, value, onChange }: {
  label: string;
  value: ListSeparator;
  onChange: (value: ListSeparator) => void;
}) {
  return (
    <ToolSelect label={label} value={value} onChange={(next) => onChange(next as ListSeparator)}
      options={[{ value: "line", label: "换行" }, { value: "comma", label: "逗号" }, { value: "tab", label: "制表符" }]} />
  );
}

export function ListConverterTool() {
  const [from, setFrom] = useState<ListSeparator>("line");
  const [to, setTo] = useState<ListSeparator>("comma");
  const [unique, setUnique] = useState(false);
  return (
    <>
      <p className="tool-form__note">转换时会去除项目首尾空白，并跳过空项。</p>
      <TextTool action="转换" inputLabel="列表" outputLabel="转换结果" resultKey={`${from}:${to}:${unique}`}
        example={convertList("dev\nqa\nprod\nqa", "line", from, false)}
        run={(input) => convertList(input, from, to, unique)}
        options={
          <>
            <SeparatorSelect label="输入分隔符" value={from} onChange={setFrom} />
            <SeparatorSelect label="输出分隔符" value={to} onChange={setTo} />
            <label className="tool-form__switch">
              <SettingsSwitch checked={unique} onChange={(event) => setUnique(event.target.checked)} />
              去重
            </label>
          </>
        }
      />
    </>
  );
}

export function RandomPortTool() {
  return <TextTool action="生成端口号" outputLabel="动态端口（49152–65535）" run={randomPort} />;
}

export function RandomTokenTool() {
  const [length, setLength] = useState("32");
  return (
    <TextTool action="生成令牌" outputLabel="随机令牌" resultKey={length} run={() => randomToolToken(length)}
      options={
        <label className="tool-form__setting">字符数
          <input className="tool-form__short-input" aria-label="字符数（16 到 128）" type="number" min={16} max={128} value={length}
            onChange={(event) => setLength(event.target.value)} />
        </label>
      }
    />
  );
}
