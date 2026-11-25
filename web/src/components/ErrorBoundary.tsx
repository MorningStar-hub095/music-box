import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: 40,
          color: '#aaa',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ fontSize: 48, opacity: 0.5 }}>⚠️</div>
          <div style={{ fontSize: 16, color: '#888' }}>加载失败</div>
          <div style={{ fontSize: 13, color: '#666', maxWidth: 400 }}>
            {this.state.error?.message || '页面加载时发生错误，请刷新页面重试'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '8px 24px',
              background: '#17C3B2',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              marginTop: 8,
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
