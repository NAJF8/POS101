import React, { useMemo, useState } from 'react'
import { formatMoney, formatDateTime, formatNumber, formatTime } from '../utils.js'

const money = value => formatMoney(Number(value || 0))

export default function OperationalDay({ day, summary, loading, error, onStart, onEnd }) {
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = day?.status === 'open'
  const forgotten = open && day.startedAt && new Date(day.startedAt).toDateString() !== new Date().toDateString()
  const startedLabel = useMemo(() => day?.startedAt ? formatDateTime(day.startedAt) : '—', [day?.startedAt])

  const start = async () => {
    if (busy) return
    setBusy(true)
    try { await onStart() } finally { setBusy(false) }
  }
  const end = async () => {
    if (busy) return
    setBusy(true)
    try { await onEnd(); setEndOpen(false) } finally { setBusy(false) }
  }

  return <section className="operational-day-card" dir="rtl" aria-label="اليوم التشغيلي">
    <div className="operational-day-heading">
      <div>
        <small>اليوم التشغيلي</small>
        <h2>{open ? day.businessDate : 'لا يوجد يوم تشغيلي مفتوح'}</h2>
      </div>
      <span className={`operational-day-status ${open ? 'open' : 'closed'}`}>{open ? 'مفتوح' : 'مغلق'}</span>
    </div>
    {open ? <>
      <div className="operational-day-meta">
        <span>بدأ: <b>{startedLabel}</b></span>
        <span>المبيعات: <b>{formatNumber(summary.count)}</b></span>
        <span>الإجمالي: <b>{money(summary.total)}</b></span>
      </div>
      {forgotten && <div className="operational-day-warning" role="status">
        اليوم التشغيلي السابق ما زال مفتوحاً — بدأ {formatTime(day.startedAt, { hour: '2-digit', minute: '2-digit' })}.
        <button type="button" onClick={() => setEndOpen(true)}>إنهاء اليوم</button>
        <span>استمرار اليوم الحالي</span>
      </div>}
      {!forgotten && <button className="primary-action operational-day-action" type="button" onClick={() => setEndOpen(true)}>إنهاء اليوم</button>}
    </> : <button className="primary-action operational-day-action" type="button" disabled={loading || busy} onClick={start}>{busy || loading ? 'جارٍ بدء اليوم…' : 'بدء اليوم'}</button>}
    {error && <p className="form-error" role="alert">{error}</p>}

    {endOpen && <div className="overlay">
      <div className="dialog operational-day-dialog">
        <h2>إنهاء اليوم التشغيلي</h2>
        <p>تاريخ اليوم: <b>{day.businessDate}</b></p>
        <p>وقت البدء: <b>{startedLabel}</b></p>
        <p>الوقت الحالي: <b>{formatDateTime(Date.now())}</b></p>
        <div className="operational-day-summary">
          <span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span>
          <span>إجمالي المبيعات <b>{money(summary.total)}</b></span>
          <span>نقدي <b>{money(summary.cash)}</b></span>
          <span>إلكتروني <b>{money(summary.electronic)}</b></span>
          <span>الخصومات <b>{money(summary.discount)}</b></span>
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => setEndOpen(false)}>رجوع</button>
          <button className="danger-button" type="button" disabled={busy} onClick={end}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد إنهاء اليوم'}</button>
        </div>
      </div>
    </div>}
  </section>
}
