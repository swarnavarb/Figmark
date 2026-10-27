import { Component, type ReactNode } from 'react';
import { reportError } from '../errors';

/**
 * A screen that throws while drawing shows this instead of taking the whole
 * app down to a blank page, and the error is reported.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError('render', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page stack" role="alert">
        <h1>Something went wrong on this screen</h1>
        <p className="muted">It has been reported. Reloading usually fixes it.</p>
        <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}
