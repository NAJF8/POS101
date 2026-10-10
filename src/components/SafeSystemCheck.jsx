import { useState } from 'react'

const statusLabel = status => status === 'pass' ? 'سليم' : status === 'warn' ? 'تنبيه' : 'فشل'

export default function SafeSystemCheck({ onRun, onTestFlow, state = { running: false, result: null } }) {
  const [copied, setCopied] = useState(false)
  const result = state.result
  const report = result ? JSON.stringify(result, null, 2) : ''
  const copyReport = async () => {
    try {
      await navigator.clipboard?.writeText(report)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { setCopied(false) }
  }
  return (
    <>
      <button className="header-btn outline-btn safe-check-button" type="button" onClick={onRun} disabled={state.running} data-testid="safe-system-check-button">
        <span>{state.running ? 'جاري الفحص...' : 'فحص وإصلاح النظام'}</span>
      </button>
      {result && (
        <div className="overlay safe-check-overlay" role="dialog" aria-modal="true" aria-labelledby="safe-check-title">
          <div className="dialog safe-check-dialog" dir="rtl">
            <button className="close" type="button" onClick={state.onClose} aria-label="إغلاق فحص النظام">×</button>
            <h2 id="safe-check-title">{result.realFlow?.status === 'fail' ? 'يوجد خلل في مسار الكاشير' : 'فحص وإصلاح النظام'}</h2>
            <p className={`safe-check-summary safe-check-${result.status}`} data-testid="safe-check-summary">
              {result.realFlow?.status === 'fail' ? 'الفحص وجد مشكلة عند إضافة منتج أو تجهيز الدفع. لم يتم إنشاء بيع أو حذف بيانات.' : result.status === 'pass' ? 'اكتمل الفحص بدون أخطاء.' : result.status === 'warn' ? 'اكتمل الفحص مع تنبيهات.' : 'تعذر إكمال بعض الفحوصات.'}
            </p>
            {result.realFlow?.status === 'fail' && <div className="safe-check-flow-error" data-testid="safe-flow-error"><b>المنتج:</b> {result.realFlow.productClicked || 'غير معروف'}<br /><b>السبب:</b> {result.realFlow.error || 'غير معروف'}<br /><b>الاقتراح:</b> راجع تفاصيل الفحص وأرسل التقرير للدعم الفني.</div>}
            <div className="safe-check-list">
              {(result.checks || []).map(check => (
                <div className="safe-check-row" key={check.name} data-status={check.status}>
                  <span>{check.name}</span><b>{statusLabel(check.status)}</b>
                  <small>{check.message}</small>
                </div>
              ))}
            </div>
            <details className="safe-check-details">
              <summary>تفاصيل الفحص (للدعم الفني)</summary>
              <pre dir="ltr">{report}</pre>
            </details>
            <div className="safe-check-actions">
              <button className="primary-btn" type="button" onClick={onTestFlow} disabled={state.running} data-testid="safe-test-cart-flow">اختبار السلة الآن</button>
              <button className="primary-btn" type="button" onClick={copyReport} data-testid="safe-system-copy-report">{copied ? 'تم النسخ' : 'نسخ التقرير'}</button>
              <button className="secondary-btn" type="button" onClick={state.onClose} data-testid="safe-system-close">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
