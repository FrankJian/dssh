import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/Button";

class ToolBoundary extends Component<{ children: ReactNode; onRetry(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tool could not be opened:", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="tools-workspace__load-error" role="alert">
      <h3>工具暂时无法打开</h3>
      <p>请重试，或选择其他工具。</p>
      <Button onClick={this.props.onRetry}>重试加载工具</Button>
    </div>;
  }
}

/** A retry must recreate React.lazy: a rejected lazy payload cannot recover. */
export function lazyTool<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return function RecoverableTool(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Loaded = useMemo(() => lazy(load), [attempt]);
    return <ToolBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={<p role="status">正在加载工具…</p>}><Loaded {...props} /></Suspense>
    </ToolBoundary>;
  };
}
