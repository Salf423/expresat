import React from 'react';

/**
 * ErrorBoundary — Componente que captura errores en hijos y muestra
 * una UI de degradación amigable con botón de recarga accesible.
 *
 * Uso:
 *  <ErrorBoundary
 *    fallback={<p>Error al cargar el componente</p>}
 *    onRecovery={() => window.location.reload()}
 *  >
 *    <HeavyComponent />
 *  </ErrorBoundary>
 *
 * Invariantes preservadas:
 * - No rompe la jerarquía de padres
 * - Loggea el error sin afectar otros componentes
 * - Permite recuperación controlada mediante onRecovery
 */

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
        this.errorInfo = null;
    }

    static getDerivedStateFromError(_error) {
        // Actualizar estado para renderizar la UI de fallback
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        // Loguear error en consola para debugging (no mostrar al usuario)
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

/** HOC alternativa para componentes funcionales */
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