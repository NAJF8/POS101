import { useState } from 'react'

export default function KioskActivation({ onActivate, busy = false, error = '' }) {
  const [code, setCode] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (!code.trim() || busy) return
    await onActivate(code.trim())
  }
  return (
    <main className="app-shell kiosk-activation-shell" dir="rtl">
      <section className="kiosk-activation-card" aria-labelledby="kiosk-activation-title">
        <div className="kiosk-activation-mark">101</div>
        <h1 id="kiosk-activation-title">تفعيل جهاز POS</h1>
        <p>هذا الجهاز يحتاج تفعيلًا موثوقًا مرة واحدة قبل تشغيل العمليات المركزية.</p>
        <form onSubmit={submit}>
          <label htmlFor="kiosk-activation-code">رمز التفعيل لمرة واحدة</label>
          <input id="kiosk-activation-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" inputMode="text" required disabled={busy} />
          <button type="submit" className="primary-action" disabled={busy || !code.trim()}>{busy ? 'جارٍ التحقق من الجهاز…' : 'تفعيل الجهاز'}</button>
        </form>
        {error && <p className="kiosk-activation-error" role="alert">{error}</p>}
        <small>لا يتم إرسال المفتاح الخاص للجهاز؛ يبقى محفوظًا محليًا داخل هذا المتصفح.</small>
      </section>
    </main>
  )
}
