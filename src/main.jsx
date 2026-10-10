import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class AppErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    const entry = { type: 'ERROR_BOUNDARY', message: String(error?.message || 'APP_RENDER_ERROR').slice(0, 240), details: { componentStack: String(info?.componentStack || '').slice(0, 500) }, timestamp: new Date().toISOString() }
    window.__POS101_LAST_UI_ERRORS__ = [...(Array.isArray(window.__POS101_LAST_UI_ERRORS__) ? window.__POS101_LAST_UI_ERRORS__ : []), entry].slice(-20)
    window.__POS101_LAST_ERROR__ = entry
    console.error('APP_RENDER_ERROR', error, info)
  }
  render() {
    if (this.state.error) return <main dir="rtl" role="alert" data-testid="app-error-fallback" style={{ padding: '2rem', textAlign: 'center' }}><h1>حدث خطأ غير متوقع</h1><p>{this.state.error?.message || 'تعذر عرض الشاشة.'}</p><button type="button" onClick={() => window.location.reload()}>إعادة تحميل النظام</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>)
