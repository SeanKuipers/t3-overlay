import { Component, type ReactNode } from "react";
import { native } from "../lib/native";

/**
 * If the overlay's UI throws, show a small visible error (instead of an invisible window),
 * report it to Settings → Diagnostics, and try again a few seconds later.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  private retry: number | undefined;

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? `${error.message}` : String(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const text = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
    native.overlayReport("error", `${text}\n${info.componentStack ?? ""}`).catch(() => {});
    window.clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.setState({ error: null }), 5000);
  }

  componentWillUnmount() {
    window.clearTimeout(this.retry);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="overlay-root">
          <div className="crash glass" data-hit title="Details in Settings → Diagnostics">
            <span className="dot fail" /> T3 Overlay hit an error, retrying… ({this.state.error})
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
