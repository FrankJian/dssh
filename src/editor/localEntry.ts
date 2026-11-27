import { open } from "@tauri-apps/plugin-dialog";

/** Selection is side-effect free until a concrete native path has been chosen. */
export async function chooseLocalEditorPath(directory: boolean, onSelected: (path: string, directory: boolean) => Promise<unknown> | unknown): Promise<void> {
  const path = await open({ directory, multiple: false });
  if (typeof path === "string") await onSelected(path, directory);
}
