export type MarkdownMode = "rich" | "source";
export function markdownModeKey(groupId: string, documentId: string) { return JSON.stringify([groupId, documentId]); }
