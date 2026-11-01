import type { JumpServerAsset, JumpServerNode } from "../models/jumpserver.ts";

export interface AssetGroup { key: string; label: string; assets: JumpServerAsset[] }

/** Group only the current API page, preserving multiple directory memberships. */
export function groupJumpServerAssets(assets: JumpServerAsset[], nodes: JumpServerNode[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const asset of assets) {
    const ids = [...new Set(asset.nodeIds ?? [])];
    const keys = ids.length ? ids : ["missing-directory"];
    for (const id of keys) {
      const node = nodeById.get(id);
      const key = node ? `node:${id}` : ids.length ? "unloaded-directories" : "missing-directory";
      if (!groups.has(key)) groups.set(key, { key, label: node?.name ?? (ids.length ? "其他目录（尚未加载）" : "未提供目录"), assets: [] });
      const group = groups.get(key)!;
      if (!group.assets.some((item) => item.id === asset.id)) group.assets.push(asset);
    }
  }
  return [...groups.values()].sort((a, b) => {
    const aNode = a.key.startsWith("node:") ? nodeById.get(a.key.slice(5)) : undefined;
    const bNode = b.key.startsWith("node:") ? nodeById.get(b.key.slice(5)) : undefined;
    if (aNode && bNode) return aNode.key.localeCompare(bNode.key, undefined, { numeric: true });
    return Number(!!bNode) - Number(!!aNode) || a.label.localeCompare(b.label);
  });
}
