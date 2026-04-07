import React from "react";

interface State { hasError: boolean }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center justify-center gap-6 px-6">
          <p className="text-xs uppercase tracking-widest text-outline">Error</p>
          <p className="text-base font-bold">予期しないエラーが発生しました</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs uppercase tracking-widest text-primary border border-primary px-6 py-2 hover:bg-primary hover:text-on-primary transition-colors cursor-pointer"
          >
            ページをリロード
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
