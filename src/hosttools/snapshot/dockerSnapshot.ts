import type { DockerSnapshot, SnapshotContainer } from "../../models/serverSnapshot";

const text = (row: Record<string, unknown>, key: string) => typeof row[key] === "string"
  ? (row[key] as string).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim() : "";
const number = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?%?$/.test(value)) return;
  const n = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
/** Docker mixes SI and binary units. Normalize to KiB before using the report formatter. */
export function dockerSize(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(B|[kKMGTPE](?:i)?B)$/.exec(value.trim());
  if (!m) return;
  const unit = m[2].toUpperCase();
  const exponent = unit === "B" ? 0 : "KMGTPE".indexOf(unit[0]) + 1;
  const n = Number(m[1]) * (unit.includes("I") ? 1024 : 1000) ** exponent / 1024;
  return Number.isFinite(n) ? n : undefined;
}
export function parseDockerSnapshot(s: Record<string, string>): DockerSnapshot {
  let invalid = false;
  const rows = (key: string) => (s[key] || "").split("\n").filter(Boolean).flatMap(line => {
    try {
      const row: unknown = JSON.parse(line);
      if (row && typeof row === "object" && !Array.isArray(row)) return [row as Record<string, unknown>];
    } catch { /* Preserve other sections/rows if one record is truncated. */ }
    invalid = true;
    return [];
  });
  const status = s.DOCKER_STATUS;
  const state: DockerSnapshot["state"] = status === "running" ? "running" : status === "not_installed" ? "not_installed" : !status && !s.DOCKER_WARNING ? "not_probed" : "unavailable";
  const info = rows("DOCKER_INFO")[0] ?? {};
  const stats = new Map(rows("DOCKER_STATS").map(row => [text(row, "id"), row]));
  const containers: SnapshotContainer[] = rows("DOCKER_CONTAINERS").flatMap(row => {
    const id = text(row, "id");
    if (!id) { invalid = true; return []; }
    const stat = stats.get(id) ?? {};
    const memory = text(stat, "memory").split("/");
    return [{ id, name: text(row, "name") || id, image: text(row, "image"), state: text(row, "state"), status: text(row, "status"), ports: text(row, "ports"),
      cpu: number(text(stat, "cpu")), memoryUsed: dockerSize(memory[0] || ""), memoryLimit: dockerSize(memory[1] || ""), memoryPercent: number(text(stat, "memoryPercent")),
      network: text(stat, "network"), block: text(stat, "block"), pids: number(text(stat, "pids")),
    }];
  });
  const warnings = [s.DOCKER_WARNING];
  if (invalid) warnings.push("部分 Docker 数据无法解析。");
  if (state === "running" && (!s.DOCKER_INFO || !("DOCKER_END" in s))) warnings.push("Docker 数据不完整。");
  return { state, version: text(info, "version"), driver: text(info, "driver"), total: number(info.total), running: number(info.running), paused: number(info.paused), stopped: number(info.stopped), images: number(info.images), containers,
    warning: warnings.filter(Boolean).join(" "),
  };
}
