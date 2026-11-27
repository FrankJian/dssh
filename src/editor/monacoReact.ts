import { loadMonaco } from "../sftp/monacoLoader";

let pending: Promise<typeof import("@monaco-editor/react")> | null = null;

/** Configure before mounting any wrapper: its default loader otherwise contacts a CDN. */
export function loadMonacoReact() {
  if (!pending) {
    pending = Promise.all([loadMonaco(), import("@monaco-editor/react")])
      .then(([monaco, react]) => {
        react.loader.config({ monaco });
        return react;
      }).catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
