export interface EditorGroup {
  kind: "group";
  id: string;
  documents: string[];
  active: string | null;
  preview: string | null;
}
export interface EditorSplit {
  kind: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [EditorLayout, EditorLayout];
}
export type EditorLayout = EditorGroup | EditorSplit;
/** Matches the bounded layout reference and native handoff contracts. */
export const MAX_EDITOR_GROUPS = 8;
export const emptyGroup = (id: string): EditorGroup => ({ kind: "group", id, documents: [], active: null, preview: null });
export function editorGroups(layout: EditorLayout): EditorGroup[] {
  return layout.kind === "group" ? [layout] : layout.children.flatMap(editorGroups);
}
export function updateGroup(layout: EditorLayout, id: string, change: (group: EditorGroup) => EditorGroup): EditorLayout {
  if (layout.kind === "group") return layout.id === id ? change(layout) : layout;
  return { ...layout, children: [updateGroup(layout.children[0], id, change), updateGroup(layout.children[1], id, change)] };
}
export function openGroupDocument(group: EditorGroup, id: string, preview: boolean, dirty: (id: string) => boolean): EditorGroup {
  if (group.documents.includes(id)) return { ...group, active: id, preview: preview ? group.preview : group.preview === id ? null : group.preview };
  const replaced = preview && group.preview && !dirty(group.preview) ? group.preview : null;
  return { ...group, documents: [...group.documents.filter((item) => item !== replaced), id], active: id, preview: preview ? id : null };
}
export function closeGroupDocument(group: EditorGroup, id: string): EditorGroup {
  const index = group.documents.indexOf(id);
  const documents = group.documents.filter((item) => item !== id);
  return { ...group, documents, active: group.active === id ? documents[Math.min(index, documents.length - 1)] ?? null : group.active,
    preview: group.preview === id ? null : group.preview };
}
export function splitEditorGroup(layout: EditorLayout, id: string, direction: EditorSplit["direction"], groupId: string, splitId: string): EditorLayout {
  if (layout.kind === "group") {
    if (layout.id !== id) return layout;
    return { kind: "split", id: splitId, direction, ratio: 0.5, children: [layout, { ...emptyGroup(groupId), documents: layout.active ? [layout.active] : [], active: layout.active }] };
  }
  return { ...layout, children: [splitEditorGroup(layout.children[0], id, direction, groupId, splitId), splitEditorGroup(layout.children[1], id, direction, groupId, splitId)] };
}
export function removeEditorGroup(layout: EditorLayout, id: string): EditorLayout | null {
  if (layout.kind === "group") return layout.id === id ? null : layout;
  const left = removeEditorGroup(layout.children[0], id); const right = removeEditorGroup(layout.children[1], id);
  return left && right ? { ...layout, children: [left, right] } : left ?? right;
}
export function resizeEditorSplit(layout: EditorLayout, id: string, ratio: number): EditorLayout {
  if (layout.kind === "group") return layout;
  return { ...layout, ratio: layout.id === id ? Math.min(0.9, Math.max(0.1, ratio)) : layout.ratio,
    children: [resizeEditorSplit(layout.children[0], id, ratio), resizeEditorSplit(layout.children[1], id, ratio)] };
}
export function moveGroupDocument(layout: EditorLayout, documentId: string, from: string, to: string, copy: boolean, before?: string): EditorLayout {
  const groups = editorGroups(layout);
  if (!groups.some((group) => group.id === from && group.documents.includes(documentId)) || !groups.some((group) => group.id === to)) return layout;
  let next = layout;
  if (!copy && from !== to) next = updateGroup(next, from, (group) => closeGroupDocument(group, documentId));
  return updateGroup(next, to, (group) => {
    const documents = group.documents.filter((id) => id !== documentId);
    const index = before ? documents.indexOf(before) : -1;
    documents.splice(index < 0 ? documents.length : index, 0, documentId);
    return { ...group, documents, active: documentId, preview: group.preview === documentId ? null : group.preview };
  });
}
