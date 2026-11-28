import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

class FeatureBoundary extends Component<{ children: ReactNode; name: string; retry(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Feature failed to load:", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="feature-load-state" role="alert"><p>{this.props.name}暂时无法打开</p><Button onClick={this.props.retry}>重试加载</Button></div>;
  }
}

/** Module-level feature boundaries preserve other mounted workspaces on failure. */
export function lazyFeature<P extends object>(name: string, loader: () => Promise<{ default: ComponentType<P> }>) {
  return function DeferredFeature(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Loaded = useMemo(() => lazy(loader), [attempt]);
    return <FeatureBoundary key={attempt} name={name} retry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={<div className="feature-load-state" role="status">正在加载{name}…</div>}><Loaded {...props} /></Suspense>
    </FeatureBoundary>;
  };
}
