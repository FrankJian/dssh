import { useState } from "react";
import { ImageExportTool } from "./TextImageTool";
import { ToolSelect, ToolSwitch } from "./ToolControls";
import { renderQrCode, wifiQrPayload, type WifiSecurity } from "./qrTools";

const levels = [
  { value: "L", label: "低（L）" }, { value: "M", label: "中（M）" },
  { value: "Q", label: "较高（Q）" }, { value: "H", label: "高（H）" },
] as const;
type Level = typeof levels[number]["value"];

export function QrTool() {
  const [level, setLevel] = useState<Level>("M");
  return (
    <ImageExportTool inputLabel="文本或网址" previewAlt="二维码预览" example="https://example.org/"
      revision={level} render={(input) => renderQrCode(input, level)}
      options={<ToolSelect label="纠错级别" value={level} options={levels} onChange={(value) => setLevel(value as Level)} />} />
  );
}

export function WifiQrTool() {
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [password, setPassword] = useState("");
  const [hidden, setHidden] = useState(false);
  return (
    <ImageExportTool
      inputLabel="Wi-Fi 网络名称（SSID）"
      previewAlt="Wi-Fi 二维码预览"
      example="Guest Network"
      revision={JSON.stringify([security, password, hidden])}
      options={
        <>
          <ToolSelect label="认证方式" value={security}
            options={[{ value: "WPA", label: "WPA / WPA2" }, { value: "WEP", label: "WEP" }, { value: "nopass", label: "开放网络" }]}
            onChange={(value) => setSecurity(value as WifiSecurity)} />
          {security !== "nopass" ? (
            <label className="tool-form__setting">密码
              <input className="tool-form__title-input" type="password" value={password} autoComplete="off"
                maxLength={128} onChange={(event) => setPassword(event.target.value)} />
            </label>
          ) : null}
          <ToolSwitch label="隐藏网络" checked={hidden} onChange={setHidden} />
        </>
      }
      render={(input) => renderQrCode(wifiQrPayload(input, password, security, hidden), "M")}
    />
  );
}
