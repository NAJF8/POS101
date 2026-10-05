import React, { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { formatMoney, formatDateTime, formatNumber, formatTime } from '../utils.js'

const money = value => formatMoney(Number(value || 0))

export default function OperationalDay({ day, summary, settlementPreview = summary, loading, error, onStart, onEnd }) {
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const open = day?.status === 'open'
  const forgotten = open && day.startedAt && new Date(day.startedAt).toDateString() !== new Date().toDateString()
  const startedLabel = useMemo(() => day?.startedAt ? formatDateTime(day.startedAt) : '—', [day?.startedAt])
  const startedTime = useMemo(() => day?.startedAt ? formatTime(day.startedAt, { hour: '2-digit', minute: '2-digit', hour12: true }) : '—', [day?.startedAt])

  const start = async () => {
    if (busy) return
    setBusy(true)
    try { await onStart() } finally { setBusy(false) }
  }
  const end = async () => {
    if (busy) return
    setBusy(true)
    if (actualCash === '') return
    try { await onEnd(actualCash); setEndOpen(false); setActualCash('') } finally { setBusy(false) }
  }

  return <section className={`operational-day-card ${open ? 'is-open' : 'is-closed'}`} dir="rtl" aria-label="اليوم التشغيلي">
    <div className="operational-day-heading">
      <div className="operational-day-title">
        <span className="operational-day-icon"><Icon name="clock" size={17} /></span>
        <div>
          <span className="operational-day-label">اليوم التشغيلي</span>
          <span className={`operational-day-status ${open ? 'open' : 'closed'}`}><i />{open ? 'مفتوح' : 'مغلق'}</span>
        </div>
      </div>
    </div>
    {open ? <div className="operational-day-body">
      <div className="operational-day-main-info">
        <strong>{day.businessDate}</strong>
        <div className="operational-day-meta">
          <span>بدأ <b>{startedTime}</b></span>
          <span>المبيعات <b>{formatNumber(summary.count)}</b></span>
          <span>الإجمالي <b>{money(summary.total)}</b></span>
        </div>
      </div>
      {forgotten
        ? <div className="operational-day-warning" role="status">
            <span>اليوم السابق ما زال مفتوحاً</span>
            <button type="button" onClick={() => setEndOpen(true)}>إنهاء اليوم</button>
          </div>
        : <button className="primary-action operational-day-action" type="button" onClick={() => setEndOpen(true)}>إنهاء اليوم</button>}
    </div> : <div className="operational-day-body">
      <div className="operational-day-empty">
        <strong>لا يوجد يوم تشغيلي مفتوح</strong>
        <small>ابدأ اليوم لبدء تسجيل المبيعات</small>
      </div>
      <button className="primary-action operational-day-action" type="button" disabled={loading || busy} onClick={start}><Icon name="arrow" size={15} />{busy || loading ? 'جارٍ بدء اليوم…' : 'بدء اليوم'}</button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}

    {endOpen && <div className="overlay">
      <div className="dialog operational-day-dialog">
        <h2>إنهاء اليوم التشغيلي</h2>
        <p>تاريخ اليوم التشغيلي: <b>{day.businessDate}</b></p>
        <p>وقت البدء: <b>{startedLabel}</b></p>
        <p>وقت الإغلاق الحالي: <b>{formatDateTime(Date.now())}</b></p>
        <div className="operational-day-summary">
          <span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span>
          <span>إجمالي المبيعات <b>{money(summary.total)}</b></span>
          <span>مبيعات نقدية <b>{money(settlementPreview.cashSales)}</b></span>
          <span>مبيعات إلكترونية <b>{money(settlementPreview.electronicSales)}</b></span>
          <span>مصاريف نقدية <b>{money(settlementPreview.expenses)}</b></span>
          <span>سحوبات <b>{money(settlementPreview.withdrawals)}</b></span>
          <span>إيداعات <b>{money(settlementPreview.deposits)}</b></span>
          <span>تعديلات <b>{money(settlementPreview.adjustments)}</b></span>
          <span>المبلغ المتوقع <b>{money(settlementPreview.expectedCash)}</b></span>
          <label className="settlement-actual-cash">المبلغ الفعلي<input type="number" min="0" value={actualCash} onChange={event => setActualCash(event.target.value)} placeholder="أدخل المبلغ الفعلي" /></label>
          {actualCash !== '' && <span>الفرق <b>{money(Number(actualCash) - settlementPreview.expectedCash)}</b></span>}
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => setEndOpen(false)}>رجوع</button>
          <button className="danger-button" type="button" disabled={busy || actualCash === ''} onClick={end}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد التسوية وإنهاء اليوم'}</button>
        </div>
      </div>
    </div>}
  </section>
}
