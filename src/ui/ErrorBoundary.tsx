import { Component, type ErrorInfo, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors so a crash surfaces an actionable message with a
 * way out, instead of a dead blank window (important for the standalone AI
 * window, which otherwise has no visible controls when the tree fails).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="app-crash" role="alert">
        <h1 className="app-crash__title">页面出错了</h1>
        <p className="app-crash__message">{error.message || "发生未知错误。"}</p>
        <div className="app-crash__actions">
          <button
            className="app-crash__button"
            onClick={() => window.location.reload()}
            type="button"
          >
            重新加载
          </button>
          <button
            className="app-crash__button"
            onClick={() => {
              void getCurrentWindow()
                .close()
                .catch(() => window.close());
            }}
            type="button"
          >
            关闭窗口
          </button>
        </div>
      </div>
    );
  }
}
