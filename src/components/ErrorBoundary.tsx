import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-container dark">
          <div className="not-found-page">
            <div className="nf-icon" style={{ fontSize: '3rem' }}>!</div>
            <h1>Something went wrong</h1>
            <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              className="cta-button"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            >
              Back to Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
