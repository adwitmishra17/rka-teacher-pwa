import React from 'react'

// =========================================================================
// ErrorBoundary — replaces the white screen of death with the actual error.
// Any route that throws during render shows the message + a reload button,
// so field reports arrive as "it said X" instead of "the screen went white".
// =========================================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: '40px 20px', maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 18, color: '#b3261e', marginBottom: 8 }}>Something went wrong on this screen</h1>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
          Please screenshot this and send it to the office — then tap reload.
        </p>
        <pre style={{
          background: '#f6f6f2', border: '1px solid #ddd', borderRadius: 8, padding: 12,
          fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#333',
        }}>
          {String(this.state.error?.message || this.state.error)}
          {this.state.info?.componentStack ? '\n—' + this.state.info.componentStack.split('\n').slice(0, 4).join('\n') : ''}
        </pre>
        <button
          onClick={() => { this.setState({ error: null, info: null }); window.location.href = '/' }}
          style={{
            marginTop: 14, padding: '10px 18px', borderRadius: 8, border: 'none',
            background: '#1a4a2e', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Reload app
        </button>
      </div>
    )
  }
}
