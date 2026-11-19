import { decodeBase64, encodeBase64 } from "./base64";
import { ipv4Subnet } from "./networkConverters";
import { useState } from "react";
import { ToolNote, ToolSelect } from "./ToolControls";
import { hashToolText } from "../services/toolsService";
import { TextTool } from "./ToolForm";
import {
  compareJson, compareText, convertChmod, convertTimestamp,
  generateUuid, parseCron,
} from "./developerTools";

function CodecTool({ kind }: { kind: "base64" | "url" }) {
  const [mode, setMode] = useState("encode");
  function convert(input: string) {
    if (kind === "base64") return mode === "encode" ? encodeBase64(input) : decodeBase64(input);
    try {
      return mode === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
    } catch {
      throw new Error("URL 组件包含无效字符或百分号转义。");
    }
  }
  return (
    <TextTool
      action={mode === "encode" ? "编码" : "解码"}
      resultKey={mode}
      example={mode === "encode" ? "Duo SSH" : kind === "base64" ? "RHVvIFNTSA==" : "Duo%20SSH"}
      inputLabel={kind === "url" ? "URL 组件 / 文本" : "Base64 / 文本"}
      outputLabel="转换结果"
      options={<ToolSelect label="操作" value={mode} onChange={setMode}
        options={[{ value: "encode", label: "编码" }, { value: "decode", label: "解码" }]} />}
      run={convert}
    />
  );
}

export function Base64Tool() { return <CodecTool kind="base64" />; }
export function UrlTool() { return <CodecTool kind="url" />; }

export function TimestampTool() {
  return (
    <>
      <ToolNote>整数时间戳最多 10 位时按秒读取，其余按毫秒读取。ISO 8601 日期须带时区。</ToolNote>
      <TextTool action="转换" inputLabel="日期或时间戳" outputLabel="转换结果" example="2026-01-01T12:00:00+08:00" run={convertTimestamp} />
    </>
  );
}

export function UuidTool() {
  return <TextTool action="生成 UUID v4" outputLabel="UUID v4" run={generateUuid} />;
}

export function TextDiffTool() {
  return <TextTool action="比较" inputLabel="原始文本" outputLabel="差异" example={"Host demo\n  Port 22"} secondInput={{ label: "比较文本", example: "Host demo\n  Port 2222" }} run={compareText} />;
}

export function JsonDiffTool() {
  return <TextTool action="比较" inputLabel="原始 JSON" outputLabel="差异" example={'{"host":"demo","port":22}'} secondInput={{ label: "比较 JSON", example: '{"port":2222,"host":"demo"}' }} run={compareJson} />;
}

export function HashTool() {
  return <TextTool action="计算 SHA-256" inputLabel="文本输入" outputLabel="SHA-256（十六进制）" example="Duo SSH" run={hashToolText} />;
}

export function SubnetTool() {
  return <TextTool action="计算" inputLabel="IPv4 CIDR" outputLabel="网络与主机范围" example="192.168.1.10/24" run={ipv4Subnet} />;
}

export function ChmodTool() {
  return <TextTool action="换算" inputLabel="三位八进制或九位 rwx 权限" outputLabel="权限换算结果" example="755" run={convertChmod} />;
}

export function CronTool() {
  const [timezone, setTimezone] = useState("UTC");
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <TextTool
      action="查看下五次执行"
      resultKey={timezone}
      inputLabel="Cron 表达式（分 时 日 月 周）"
      outputLabel="调度预览"
      example="0 9 * * MON-FRI"
      options={<ToolSelect label="时区" value={timezone} onChange={setTimezone}
        options={[{ value: "UTC", label: "UTC" }, ...(local !== "UTC" ? [{ value: local, label: `本地（${local}）` }] : [])]} />}
      run={(input) => parseCron(input, timezone)}
    />
  );
}
