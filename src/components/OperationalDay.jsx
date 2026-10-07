import React, { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { formatMoney, formatDateTime, formatNumber, formatTime } from '../utils.js'

const money = value => formatMoney(Number(value || 0))

export default function OperationalDay({ day, summary, settlementPreview = summary, preCloseGuard = null, loading, error, onPrepareEnd, onPrepareStart, onStart, onEnd }) {
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')
  const [openingCash, setOpeningCash] = useState('')
  const [openingNote, setOpeningNote] = useState('')
  const [openingSuggestion, setOpeningSuggestion] = useState(null)
  React.useEffect(() => {
    const dirty = Boolean(startOpen || endOpen || openingCash || openingNote || actualCash)
    window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty } }))
    return () => window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty: false } }))
  }, [startOpen, endOpen, openingCash, openingNote, actualCash])
  const open = day?.status === 'open'
  const forgotten = open && day.startedAt && new Date(day.startedAt).toDateString() !== new Date().toDateString()
  const startedLabel = useMemo(() => day?.startedAt ? formatDateTime(day.startedAt) : '—', [day?.startedAt])
  const startedTime = useMemo(() => day?.startedAt ? formatTime(day.startedAt, { hour: '2-digit', minute: '2-digit', hour12: true }) : '—', [day?.startedAt])

  const start = async () => {
    if (busy || startBusy) return
    setStartBusy(true); setStartError('')
    try {
      const suggestion = await onPrepareStart?.()
      setOpeningSuggestion(suggestion || null)
      setOpeningCash(suggestion?.effectiveActualClosingCash == null ? '' : String(suggestion.effectiveActualClosingCash))
      setOpeningNote('')
      setStartOpen(true)
    } catch (error) { setStartError(error?.message || 'تعذر قراءة رصيد إغلاق اليوم السابق.') } finally { setStartBusy(false) }
  }
  const confirmStart = async () => {
    if (openingCash === '' || Number(openingCash) < 0) { setStartError('أكد رصيد بداية اليوم أولاً.'); return }
    setStartBusy(true); setStartError('')
    try {
      const suggested = openingSuggestion?.effectiveActualClosingCash
      await onStart({ openingCashBalance: Number(openingCash), openingCashSource: suggested != null && Number(openingCash) === Number(suggested) ? 'previous_closing' : 'manual', previousOperationalDayId: openingSuggestion?.previousOperationalDay?.id || '', openingCashAdjustmentNote: openingNote })
      setStartOpen(false)
    } catch (error) { setStartError(error?.message || 'تعذر بدء اليوم.') } finally { setStartBusy(false) }
  }
  const end = async () => {
    if (busy) return
    if (preCloseGuard?.allowed === false) return
    setBusy(true)
    if (actualCash === '') return
    try { await onEnd(actualCash); setEndOpen(false); setActualCash('') } finally { setBusy(false) }
  }
  const openEnd = async () => {
    if (busy) return
    setBusy(true)
    try { await onPrepareEnd?.(); setEndOpen(true) } catch { /* App surfaces the guard error. */ } finally { setBusy(false) }
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
            <button type="button" disabled={preCloseGuard?.loading || preCloseGuard?.allowed === false} onClick={openEnd}>إنهاء اليوم</button>
          </div>
        : <button className="primary-action operational-day-action" type="button" disabled={preCloseGuard?.loading || preCloseGuard?.allowed === false} onClick={openEnd}>إنهاء اليوم</button>}
    </div> : <div className="operational-day-body">
      <div className="operational-day-empty">
        <strong>لا يوجد يوم تشغيلي مفتوح</strong>
        <small>ابدأ اليوم لبدء تسجيل المبيعات</small>
      </div>
      <button className="primary-action operational-day-action" type="button" disabled={loading || busy || startBusy} onClick={start}><Icon name="arrow" size={15} />{busy || loading || startBusy ? 'جارٍ التحضير…' : 'بدء اليوم'}</button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {startError && <p className="form-error" role="alert">{startError}</p>}
    {open && preCloseGuard?.message && <p className="form-error" role="alert">{preCloseGuard.message}</p>}

    {startOpen && <div className="overlay"><div className="dialog operational-day-dialog" dir="rtl">
      <h2>بدء يوم تشغيلي جديد</h2>
      <p>رصيد الصندوق عند بداية اليوم</p>
      {openingSuggestion?.effectiveActualClosingCash != null
        ? <p>صندوق اليوم السابق: <b>{money(openingSuggestion.effectiveActualClosingCash)}</b></p>
        : <p role="status">لا يوجد رصيد إغلاق فعلي محفوظ لليوم السابق.</p>}
      <label>رصيد بداية اليوم<input autoFocus type="number" min="0" value={openingCash} onChange={event => setOpeningCash(event.target.value)} placeholder="أدخل رصيد البداية" /></label>
      {openingSuggestion?.effectiveActualClosingCash != null && Number(openingCash) !== Number(openingSuggestion.effectiveActualClosingCash) && <label>ملاحظة تعديل الرصيد<textarea value={openingNote} onChange={event => setOpeningNote(event.target.value)} placeholder="اختياري" /></label>}
      <div className="dialog-actions"><button className="secondary-action" type="button" disabled={startBusy} onClick={() => setStartOpen(false)}>إلغاء</button><button className="primary-action" type="button" disabled={startBusy || openingCash === ''} onClick={confirmStart}>{startBusy ? 'جارٍ الحفظ…' : 'تأكيد رصيد البداية'}</button></div>
    </div></div>}

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
          <span>صندوق اليوم السابق <b>{settlementPreview.openingCashBalance == null ? 'غير متوفر' : money(settlementPreview.openingCashBalance)}</b></span>
          <span>رصيد بداية اليوم <b>{settlementPreview.openingCashBalance == null ? 'غير متوفر' : money(settlementPreview.openingCashBalance)}</b></span>
          <span>مصاريف نقدية <b>{money(settlementPreview.expenses)}</b></span>
          <span>سحوبات من الصندوق <b>{money(settlementPreview.cashboxWithdrawals)}</b></span>
          <span>سحوبات من الإدارة <b>{money(settlementPreview.managementWithdrawals)}</b></span>
          <span>إيداعات <b>{money(settlementPreview.deposits)}</b></span>
          <span>صافي حركة اليوم <b>{money(settlementPreview.dailyCashMovement)}</b></span>
          <span>المبلغ المتوقع بالصندوق نهاية اليوم <b>{settlementPreview.openingCashBalance == null ? 'غير متوفر' : money(settlementPreview.expectedClosingCash)}</b></span>
          <label className="settlement-actual-cash">المبلغ الفعلي<input type="number" min="0" value={actualCash} onChange={event => setActualCash(event.target.value)} placeholder="أدخل المبلغ الفعلي" /></label>
          {actualCash !== '' && settlementPreview.openingCashBalance != null && <span>الفرق <b>{money(Number(actualCash) - settlementPreview.expectedClosingCash)}</b></span>}
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => setEndOpen(false)}>رجوع</button>
          <button className="danger-button" type="button" disabled={busy || actualCash === ''} aria-disabled={preCloseGuard?.allowed === false} onClick={end}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد التسوية وإنهاء اليوم'}</button>
        </div>
      </div>
    </div>}
  </section>
}
