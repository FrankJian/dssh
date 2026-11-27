import type { EditorWorkbenchHandle } from "./EditorWorkbench.tsx";
export interface WindowCloseOptions {
  editors: EditorWorkbenchHandle[];
  allowed(): boolean;
  confirmTerminals(): Promise<boolean>;
  commit(): Promise<void>;
}
/** Prepare without releasing resources; callers can collect decisions across windows. */
export async function prepareEditorWindowClose(options: WindowCloseOptions) {
  if (!options.allowed()) return null;
  const plans: Array<{ handle: EditorWorkbenchHandle; plan: NonNullable<Awaited<ReturnType<EditorWorkbenchHandle["prepareClose"]>>> }> = [];
  for (const handle of options.editors) {
    const plan = await handle.prepareClose(); if (!plan || !options.allowed()) return null;
    plans.push({ handle, plan });
  }
  if (!await options.confirmTerminals() || !options.allowed() || !plans.every(({ handle, plan }) => handle.validClose(plan))) return null;
  for (const { handle } of plans) handle.freeze();
  let released = false;
  return {
    valid: () => !released && options.allowed() && plans.every(({ handle, plan }) => handle.validFrozenClose(plan)),
    cancel: () => { if (!released) { released = true; for (const { handle } of plans) handle.thaw(); } },
    commit: options.commit,
  };
}
/** Collect every decision before terminating terminals or releasing a document. */
export async function coordinateEditorWindowClose(options: WindowCloseOptions): Promise<boolean> {
  const prepared = await prepareEditorWindowClose(options);
  if (!prepared) return false;
  try { await prepared.commit(); return true; }
  finally { prepared.cancel(); }
}
