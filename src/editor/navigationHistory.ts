export interface EditorLocation { id: string; path: string | null; line: number; column: number }
/** In-memory navigation only: never persists document bodies or unsaved paths. */
export class EditorNavigationHistory {
  private entries: EditorLocation[] = [];
  private index = -1;
  get canBack() { return this.index > 0; }
  get canForward() { return this.index + 1 < this.entries.length; }
  record(location: EditorLocation) {
    const previous = this.entries[this.index];
    if (previous?.id === location.id && previous.line === location.line && previous.column === location.column) return;
    this.entries = [...this.entries.slice(0, this.index + 1), { ...location }].slice(-100);
    this.index = this.entries.length - 1;
  }
  update(location: EditorLocation) {
    if (this.entries[this.index]?.id === location.id) this.entries[this.index] = { ...location };
  }
  move(delta: -1 | 1) {
    const index = this.index + delta;
    if (index < 0 || index >= this.entries.length) return null;
    this.index = index;
    return { ...this.entries[index] };
  }
}
