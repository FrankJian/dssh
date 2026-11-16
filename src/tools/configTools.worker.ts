import type { SqlLanguage } from "sql-formatter";
import {
  convertToToml, convertToml, jsonToXml, prettifySql, prettifyXml, prettifyYaml, xmlToJson,
} from "./configConversions";
import { dockerRunToCompose } from "./dockerCompose";
import { receiveLocalTool } from "./localToolWorker";

receiveLocalTool(({ id, input, option }) => {
  switch (id) {
    case "toml-json": return convertToml(input, "json");
    case "toml-yaml": return convertToml(input, "yaml");
    case "json-toml": return convertToToml(input, "json");
    case "yaml-toml": return convertToToml(input, "yaml");
    case "xml-json": return xmlToJson(input);
    case "json-xml": return jsonToXml(input);
    case "xml-format": return prettifyXml(input);
    case "yaml-format": return prettifyYaml(input);
    case "sql-format": return prettifySql(input, option as SqlLanguage);
    case "docker-compose": return dockerRunToCompose(input);
    default: throw new Error("未知的转换操作。");
  }
});
