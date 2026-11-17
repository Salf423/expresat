import React from 'react';

/**
 * Catches React rendering errors in child subtrees and renders a fallback UI
 * with an optional recovery trigger.
 */

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
        this.errorInfo = null;
    }

    static getDerivedStateFromError(_error) {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error("ErrorBoundary captured error:", error, info);
        this.errorInfo = info;
    }

    render() {
        if (this.state.hasError) {
            const { fallback, onRecovery } = this.props;
            return (
                <div style={{
                    padding: '2rem',
                    border: '1px solid var(--panel-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--panel-bg)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    minHeight: '80px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'sans-serif'
                }}>
                    {typeof fallback === 'string' ? (
                        <p>{fallback}</p>
                    ) : (
                        fallback
                    )}
                    {onRecovery && (
                        <button
                            onClick={onRecovery}
                            style={{
                                marginTop: '1rem',
                                padding: '0.5rem 1rem',
                                background: 'var(--accent-primary)',
                                color: 'white',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                fontSize: '0.9rem'
                            }}
                        >
                            Reintentar
                        </button>
                    )}
                </div>
            );
        }
        return this.props.children;
    }
}

/** Functional component wrapper for ErrorBoundary. */
function withErrorBoundary(WrappedComponent, fallback, onRecovery) {
    return function ErrorBoundaryWrapper(props) {
        return (
            <ErrorBoundary
                fallback={fallback}
                onRecovery={onRecovery}
            >
                <WrappedComponent {...props} />
            </ErrorBoundary>
        );
    };
}

export default ErrorBoundary;
export { withErrorBoundary };