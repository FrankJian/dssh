import type { TerminalOutputEvent, TerminalOutputSubscription, TerminalStreamEvent, TerminalStatusEvent } from "../services/sshSessionService.ts";

interface StreamServices {
  subscribe: (sessionId: string, subscriptionId: string, handler: (event: TerminalStreamEvent) => void, afterOffset?: number) => Promise<TerminalOutputSubscription>;
  unsubscribe: (sessionId: string, subscriptionId: string) => Promise<void>;
  token: () => string;
}
interface Subscription {
  token: string;
  nextOffset: number | null;
  pending: TerminalStreamEvent[];
  registration?: Promise<TerminalOutputSubscription>;
}

/** Joins a retained snapshot to live output exactly once, even when events beat
 * the invoke response. A dedicated IPC channel is ready at registration. No React state
 * is consulted on the hot path, including during creation and window transfers. */
export class TerminalOutputStream {
  private readonly subscriptions = new Map<string, Subscription>();

  private readonly services: StreamServices;
  private readonly onOutput: (event: TerminalOutputEvent) => void;
  private readonly onStatus: (event: TerminalStatusEvent) => void;
  private readonly onError: (error: Error) => void;

  constructor(services: StreamServices, onOutput: (event: TerminalOutputEvent) => void, onStatus: (event: TerminalStatusEvent) => void, onError: (error: Error) => void) {
    this.services = services;
    this.onOutput = onOutput;
    this.onStatus = onStatus;
    this.onError = onError;
  }

  has(sessionId: string) { return this.subscriptions.has(sessionId); }

  async start(sessionId: string, applySnapshot: (snapshot: TerminalOutputSubscription) => void, afterOffset?: number) {
    if (afterOffset !== undefined && (!Number.isSafeInteger(afterOffset) || afterOffset < 0)) {
      throw new Error("终端恢复检查点无效。");
    }
    // Incremental attachment is for a fresh target view. Replacing a live view
    // requires a separate handoff protocol; do not stop its stream speculatively.
    if (afterOffset !== undefined && this.has(sessionId)) {
      throw new Error("当前视图已订阅此终端，请保留现有输出连接。");
    }
    this.stop(sessionId);
    const record: Subscription = { token: this.services.token(), nextOffset: null, pending: [] };
    this.subscriptions.set(sessionId, record);
    try {
      record.registration = this.services.subscribe(sessionId, record.token, (event) => this.receive(event), afterOffset);
      const snapshot = await record.registration;
      if (this.subscriptions.get(sessionId) !== record) throw new Error("终端订阅已取消。");
      if (snapshot.session.id !== sessionId || !Number.isSafeInteger(snapshot.startOffset)
        || !Number.isSafeInteger(snapshot.endOffset) || snapshot.startOffset < 0
        || snapshot.endOffset < snapshot.startOffset
        || snapshot.endOffset - snapshot.startOffset !== new TextEncoder().encode(snapshot.data).length
        || (afterOffset !== undefined && snapshot.startOffset !== afterOffset)) {
        throw new Error("终端恢复输出不完整，未应用历史记录。");
      }
      applySnapshot(snapshot);
      record.nextOffset = snapshot.endOffset;
      const pending = record.pending;
      record.pending = [];
      for (const event of pending) this.receive(event);
      if (this.subscriptions.get(sessionId) !== record) throw new Error("终端订阅已取消或输出不同步。");
      return snapshot.session;
    } catch (error) {
      if (this.subscriptions.get(sessionId) === record) this.stop(sessionId);
      throw error;
    }
  }

  private receive(event: TerminalStreamEvent) {
    const record = this.subscriptions.get(event.sessionId);
    if (!record || record.token !== event.subscriptionId) return;
    if (record.nextOffset === null) { record.pending.push(event); return; }
    if (event.type === "status") { this.onStatus(event); return; }
    if (event.endOffset <= record.nextOffset) return; // An already-included snapshot/event.
    if (event.startOffset !== record.nextOffset) {
      this.stop(event.sessionId);
      this.onError(new Error("终端输出顺序异常，请重新连接此会话。"));
      return;
    }
    record.nextOffset = event.endOffset;
    this.onOutput(event);
  }

  stop(sessionId: string) {
    const record = this.subscriptions.get(sessionId);
    if (!record) return;
    this.subscriptions.delete(sessionId);
    record.pending = [];
    // An invoke may still be registering. Unsubscribe after it settles too, so
    // cancelling a pending attach cannot leave a backend subscriber behind.
    if (record.registration) {
      const remove = () => this.services.unsubscribe(sessionId, record.token);
      void record.registration.then(remove, remove).catch(() => {});
    }
  }

  stopAll() {
    for (const sessionId of this.subscriptions.keys()) this.stop(sessionId);
  }
}
