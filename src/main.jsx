import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const text = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).slice(0, 240) : ''
const loadedBundle = () => Array.from(document.scripts || []).map(script => script.src).find(src => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(src))?.split('/').pop().split('?')[0] || 'UNKNOWN_BUNDLE'
const copyText = async value => {
  const report = JSON.stringify(value, null, 2)
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(report); return true }
    const textarea = document.createElement('textarea')
    textarea.value = report
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch { return false }
}

class AppErrorBoundary extends React.Component {
  state = { error: null, copied: false }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    const lastProduct = window.__POS101_LAST_PRODUCT_CLICKED__ || window.__POS101_LAST_MODAL_PRODUCT__ || {}
    const entry = {
      type: 'ERROR_BOUNDARY',
      message: text(error?.message) || 'APP_RENDER_ERROR',
      componentStack: text(info?.componentStack),
      lastAction: text(window.__POS101_LAST_ACTION__) || 'UNKNOWN',
      lastProductName: text(lastProduct.name) || 'UNKNOWN',
      lastProductId: text(lastProduct.id) || 'UNKNOWN',
      lastCartItemSummary: window.__POS101_LAST_CART_ITEM_SUMMARY__ || null,
      activeOrderSummary: window.__POS101_ACTIVE_ORDER_SUMMARY__ || null,
      realClickDiagnostic: window.__POS101_REAL_CLICK_DIAGNOSTIC__ || null,
      realErrorStage: window.__POS101_REAL_CLICK_DIAGNOSTIC__?.REAL_ERROR_STAGE || 'NONE',
      loadedBundle: loadedBundle(),
      timestamp: new Date().toISOString(),
    }
    window.__POS101_LAST_UI_ERRORS__ = [...(Array.isArray(window.__POS101_LAST_UI_ERRORS__) ? window.__POS101_LAST_UI_ERRORS__ : []), entry].slice(-20)
    window.__POS101_LAST_ERROR__ = entry
    console.error('APP_RENDER_ERROR', { message: entry.message, componentStack: entry.componentStack, lastAction: entry.lastAction, lastProductName: entry.lastProductName, lastProductId: entry.lastProductId, loadedBundle: entry.loadedBundle })
  }

  copyReport = async () => {
    const copied = await copyText(window.__POS101_LAST_ERROR__ || { message: this.state.error?.message || 'APP_RENDER_ERROR', loadedBundle: loadedBundle() })
    this.setState({ copied })
    if (copied) window.setTimeout(() => this.setState({ copied: false }), 1600)
  }

  render() {
    if (this.state.error) return (
      <main dir="rtl" role="alert" data-testid="app-error-fallback" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>حدث خطأ في شاشة الكاشير</h1>
        <p>لم يتم إنشاء بيع. اضغط إعادة تحميل النظام أو أرسل التقرير للدعم.</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={this.copyReport}>{this.state.copied ? 'تم نسخ التقرير' : 'نسخ التقرير'}</button>
          <button type="button" onClick={() => window.location.reload()}>إعادة تحميل النظام</button>
        </div>
      </main>
    )
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>)
