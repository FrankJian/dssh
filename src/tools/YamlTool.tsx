import { useState } from "react";
import { ToolNote, ToolSelect } from "./ToolControls";
import { TextTool } from "./ToolForm";
import { jsonToYaml, yamlToJson } from "./jsonYaml";

export default function YamlTool() {
  const [direction, setDirection] = useState("json");
  const fromJson = direction === "json";
  return (
    <>
      <ToolNote>YAML 注释在转换时会丢弃。</ToolNote>
      <TextTool
        action="转换"
        example={fromJson ? '{"name":"Duo SSH","ports":[22,443]}' : "name: Duo SSH\nports:\n  - 22\n  - 443"}
        resultKey={direction}
        inputLabel={fromJson ? "JSON 输入" : "YAML 输入"}
        outputLabel={fromJson ? "YAML 结果" : "JSON 结果"}
        options={
          <ToolSelect label="转换方向" value={direction} onChange={setDirection}
            options={[{ value: "json", label: "JSON → YAML" }, { value: "yaml", label: "YAML → JSON" }]} />
        }
        run={fromJson ? jsonToYaml : yamlToJson}
      />
    </>
  );
}
