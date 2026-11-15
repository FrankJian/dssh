import { useState } from "react";
import { ToolSelect } from "./ToolControls";
import { TextTool } from "./ToolForm";
import { formatJson } from "./jsonYaml";

export default function JsonFormatTool() {
  const [indent, setIndent] = useState<0 | 2 | 4>(2);
  return (
    <TextTool
      action={indent ? "格式化" : "压缩"}
      example={'{"name":"Duo SSH","ports":[22,443],"enabled":true}'}
      resultKey={indent}
      inputLabel="JSON 输入"
      outputLabel="JSON 结果"
      options={
        <ToolSelect label="输出格式" value={String(indent)}
          onChange={(value) => setIndent(Number(value) as 0 | 2 | 4)}
          options={[{ value: "2", label: "2 空格" }, { value: "4", label: "4 空格" }, { value: "0", label: "压缩" }]} />
      }
      run={(input) => formatJson(input, indent)}
    />
  );
}
