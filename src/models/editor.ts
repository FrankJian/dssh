export type FileSource = { kind: "local" } | { kind: "sftp"; profileId: string };
export type TextEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030";
export type LineEnding = "lf" | "crlf" | "mixed";
export interface TextMetadata { encoding: TextEncoding; lineEnding: LineEnding; bom: boolean }
export interface FileIdentity { source: FileSource; path: string }
export interface LoadedText extends FileIdentity, TextMetadata {
  content: string;
  versionToken: string;
  readOnly: boolean;
  byteLength?: number;
  largeFile?: boolean;
}
export interface SaveSnapshot extends FileIdentity, TextMetadata {
  content: string;
  expectedVersion: string | null;
}
export interface SavedText extends FileIdentity { versionToken: string }
export interface EditorFileVersion extends FileIdentity { versionToken: string | null; readOnly: boolean; byteLength: number }
export interface EditorWorkspace {
  id: string;
  source: FileSource;
  rootPath: string | null;
  initialFile: string | null;
}
export interface EditorOpenRequest { source: FileSource; path?: string; directory?: boolean; rootPath?: string }
export interface EditorReadRequest { workspaceId: string; path: string; encoding?: TextEncoding; allowLarge?: boolean }
export type EditorSaveRequest = Omit<SaveSnapshot, "source"> & { workspaceId: string; allowNonAtomic?: boolean };
export interface EditorScanRequest { workspaceId: string; content: boolean; showHidden: boolean; include: string[]; exclude: string[]; skipPaths: string[] }
export interface EditorScanProgress { directories: number; entries: number; bytes: number; unreadable: number; binary: number; encoding: number; oversized: number; links: number; done: boolean; reason: string | null }
export interface EditorScanItem { path: string; relativePath: string; file: LoadedText | null }
export interface EditorScanBatch { operationId: string; items: EditorScanItem[]; progress: EditorScanProgress }
export type EditorFileAction =
  | { kind: "createFile" | "createDirectory"; parentPath: string; name: string }
  | { kind: "rename"; path: string; name: string }
  | { kind: "move" | "copy"; paths: string[]; targetDirectory: string }
  | { kind: "delete"; paths: string[] };
export interface EditorFileMutationResult { path: string; destination: string | null; status: "success" | "failed" | "cancelled"; message: string | null }
export interface EditorDeletePreview { path: string; files: number; directories: number; symlinks: number; paths: string[]; truncated: boolean }
