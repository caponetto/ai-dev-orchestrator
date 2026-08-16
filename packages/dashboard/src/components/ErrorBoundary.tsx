import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen items-center justify-center bg-background p-8">
        <div className="max-w-lg rounded-lg border border-destructive/50 bg-card p-8 text-center">
          <div className="mb-4 text-3xl text-destructive">Something went wrong</div>
          <p className="mb-6 text-sm text-muted-foreground">
            An unexpected error occurred. Try reloading the page.
          </p>
          {this.state.error && (
            <pre className="mb-6 max-h-40 overflow-auto rounded bg-muted p-3 text-left text-xs text-destructive/80">
              {this.state.error.message}
            </pre>
          )}
          <Button
            type="button"
            onClick={() => {
              globalThis.location.reload();
            }}
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
