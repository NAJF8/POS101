import React, { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { formatMoney, formatDateTime, formatNumber, formatTime } from '../utils.js'
import { verifySystemAdminCode } from '../services/systemAdminCode.js'
import { createRecoverySnapshot, downloadRecoverySnapshot } from '../services/recoverySnapshot.js'
import { calculateEndDayCashAnalysis, hasActualCash, toMoneyNumber } from '../services/financialCenter.js'

const money = value => formatMoney(toMoneyNumber(value, 0))
const displayMoney = value => value === null || value === undefined || value === '' ? '—' : money(value)
const differenceLabel = value => value === null || value === undefined || value === '' ? '' : toMoneyNumber(value, 0) === 0 ? 'مطابق' : toMoneyNumber(value, 0) < 0 ? 'نقص' : 'زيادة'
const ACTUAL_CASH_PENDING = 'بانتظار إدخال الكاش الفعلي'

export default function OperationalDay({ day = {}, summary = {}, settlementPreview = summary, preCloseGuard = null, pendingTableCount = 0, loading, error, onPrepareEnd, onPrepareStart, onStart, onSetOpeningCashBalance, onEnd, onReadDiagnostic }) {
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')
  const [openingCash, setOpeningCash] = useState('')
  const [openingNote, setOpeningNote] = useState('')
  const [openingSuggestion, setOpeningSuggestion] = useState(null)
  const [openingAdjustOpen, setOpeningAdjustOpen] = useState(false)
  const [openingAdjustBusy, setOpeningAdjustBusy] = useState(false)
  const [openingAdjustError, setOpeningAdjustError] = useState('')
  const [openingAdjustCash, setOpeningAdjustCash] = useState('')
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const [diagnosticCode, setDiagnosticCode] = useState('')
  const [diagnosticError, setDiagnosticError] = useState('')
  const [diagnosticBusy, setDiagnosticBusy] = useState(false)
  const [diagnosticReport, setDiagnosticReport] = useState(null)
  const [diagnosticCopied, setDiagnosticCopied] = useState(false)
  const [diagnosticAuthorized, setDiagnosticAuthorized] = useState(false)
  const [recoveryExportBusy, setRecoveryExportBusy] = useState(false)
  const [recoveryExported, setRecoveryExported] = useState('')
  React.useEffect(() => {
    const dirty = Boolean(startOpen || endOpen || openingCash || openingNote || actualCash)
    window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty } }))
    return () => window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty: false } }))
  }, [startOpen, endOpen, openingCash, openingNote, actualCash])
  const open = day?.status === 'open'
  const forgotten = open && day.startedAt && new Date(day.startedAt).toDateString() !== new Date().toDateString()
  const startedLabel = useMemo(() => day?.startedAt ? formatDateTime(day.startedAt) : '—', [day?.startedAt])
  const startedTime = useMemo(() => day?.startedAt ? formatTime(day.startedAt, { hour: '2-digit', minute: '2-digit', hour12: true }) : '—', [day?.startedAt])
  const safeSettlementPreview = settlementPreview ?? {}
  const expectedCashOpening = toMoneyNumber(safeSettlementPreview.openingCashBalance ?? safeSettlementPreview.openingBalance ?? safeSettlementPreview.openingCashBalanceOrZero, 0)
  const endDayAnalysis = useMemo(() => calculateEndDayCashAnalysis({
    openingCashBalance: safeSettlementPreview.openingCashBalance ?? safeSettlementPreview.openingBalance ?? day?.openingCashBalance,
    cashSales: safeSettlementPreview.cashSales,
    expenses: safeSettlementPreview.expenses,
    withdrawals: safeSettlementPreview.withdrawals,
    expectedCash: safeSettlementPreview.expectedClosingCash ?? safeSettlementPreview.expectedCash,
    actualCash,
  }), [safeSettlementPreview, day?.openingCashBalance, actualCash])

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
  const openOpeningAdjust = () => {
    setOpeningAdjustCash(day?.openingCashBalance == null ? '' : String(day.openingCashBalance))
    setOpeningAdjustError('')
    setOpeningAdjustOpen(true)
  }
  const saveOpeningAdjust = async () => {
    if (openingAdjustBusy || openingAdjustCash === '' || Number(openingAdjustCash) < 0) return
    setOpeningAdjustBusy(true); setOpeningAdjustError('')
    try {
      await onSetOpeningCashBalance?.({ openingCashBalance: Number(openingAdjustCash), reason: 'رصيد افتتاحي/تمويل صندوق مفقود.' })
      setOpeningAdjustOpen(false)
    } catch (saveError) { setOpeningAdjustError(saveError?.message || 'تعذر تحديث رصيد الافتتاح.') } finally { setOpeningAdjustBusy(false) }
  }
  const openDiagnostic = () => {
    setDiagnosticOpen(true)
    setDiagnosticCode('')
    setDiagnosticError('')
    setDiagnosticCopied(false)
    setDiagnosticAuthorized(false)
    setRecoveryExported('')
  }
  const runDiagnostic = async () => {
    if (!verifySystemAdminCode(diagnosticCode)) {
      setDiagnosticError('رمز التشخيص غير صحيح.')
      return
    }
    setDiagnosticAuthorized(true)
    setDiagnosticBusy(true)
    setDiagnosticError('')
    setDiagnosticCopied(false)
    try {
      setDiagnosticReport(await onReadDiagnostic?.())
    } catch (diagnosticFailure) {
      setDiagnosticError(diagnosticFailure?.message || 'تعذر قراءة تشخيص المزامنة.')
    } finally { setDiagnosticBusy(false) }
  }
  const exportRecoverySnapshot = async () => {
    if (recoveryExportBusy || !diagnosticAuthorized) return
    setRecoveryExportBusy(true)
    setDiagnosticError('')
    try {
      const snapshot = await createRecoverySnapshot()
      setRecoveryExported(downloadRecoverySnapshot(snapshot))
    } catch (exportFailure) {
      setDiagnosticError(exportFailure?.message || 'تعذر تصدير نسخة الاستعادة.')
    } finally { setRecoveryExportBusy(false) }
  }
  const diagnosticText = report => {
    if (!report) return ''
    const lines = [
      'END_DAY_DIAGNOSTIC',
      `LIVE_COMMIT=${report.LIVE_COMMIT || ''}`,
      `LIVE_BUNDLE=${report.LIVE_BUNDLE || ''}`,
      `businessDate=${report.businessDate || ''}`,
      `operationalDayId=${report.operationalDayId || ''}`,
      `localActiveCount=${report.localActiveCount ?? 0}`,
      `localActiveTotal=${report.localActiveTotal ?? 0}`,
      `firebaseActiveCount=${report.firebaseActiveCount ?? 0}`,
      `firebaseActiveTotal=${report.firebaseActiveTotal ?? 0}`,
      `pendingSaleWrite=${report.pendingSaleWrite ?? 0}`,
      `pendingVoidUpdate=${report.pendingVoidUpdate ?? 0}`,
      `voidedBeforeSyncResolved=${report.voidedBeforeSyncResolved ?? 0}`,
      `queueItems=${report.queueItems ?? 0}`,
      `blockingItems=${report.blockingItems ?? 0}`,
      `END_DAY_READY=${report.END_DAY_READY || 'NO'}`,
      `pendingQueue=${report.pendingQueue}`,
      `openOrderFlag=${report.openOrderFlag}`,
      `reconciliationState=${report.reconciliationState}`,
      `status=${report.status}`,
      `message=${report.message || ''}`,
    ]
    for (const blocker of report.blockers || []) {
      lines.push('', `ORDER=${blocker.orderNumber}`, `saleId=${blocker.saleId}`, `source=${blocker.source}`, `businessDate=${blocker.businessDate}`, `operationalDayId=${blocker.operationalDayId}`, `operationKey=${blocker.operationKey}`, `localStatus=${blocker.localStatus}`, `localSyncStatus=${blocker.localSyncStatus}`, `centralExists=${blocker.centralExists}`, `centralStatus=${blocker.centralStatus}`, `centralSyncStatus=${blocker.centralSyncStatus}`, `salePayloadMatches=${blocker.salePayloadMatches}`, `mismatchFields=${blocker.mismatchFields.join(',')}`, `queueEntryExists=${blocker.queueEntryExists}`)
      for (const entry of blocker.queueEntries || []) lines.push(`queueOperationType=${entry.operationType}`, `queueId=${entry.id}`, `queueBusinessDate=${entry.businessDate}`, `queueOperationalDayId=${entry.operationalDayId}`)
    }
    return lines.join('\n')
  }
  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText(diagnosticReport))
      setDiagnosticCopied(true)
    } catch { setDiagnosticError('تعذر نسخ تقرير التشخيص.') }
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
            <button type="button" onClick={openOpeningAdjust}>تعديل رصيد الافتتاح</button>
            <button type="button" onClick={openDiagnostic}>فحص المزامنة</button>
          </div>
        : <div className="operational-day-actions"><button className="primary-action operational-day-action" type="button" disabled={preCloseGuard?.loading || preCloseGuard?.allowed === false} onClick={openEnd}>إنهاء اليوم</button><button className="secondary-action operational-day-diagnostic-action" type="button" onClick={openOpeningAdjust}>تعديل رصيد الافتتاح</button><button className="secondary-action operational-day-diagnostic-action" type="button" onClick={openDiagnostic}>فحص المزامنة</button></div>}
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

    {openingAdjustOpen && <div className="overlay"><div className="dialog operational-day-dialog" dir="rtl">
      <h2>تعديل رصيد الافتتاح</h2>
      <p>هذا التعديل لا يغلق اليوم ولا يغيّر المبيعات أو المصروفات أو السحوبات.</p>
      <label>رصيد الافتتاح<input autoFocus type="number" min="0" value={openingAdjustCash} onChange={event => setOpeningAdjustCash(event.target.value)} /></label>
      <p role="note">السبب: رصيد افتتاحي/تمويل صندوق مفقود.</p>
      {openingAdjustError && <p className="form-error" role="alert">{openingAdjustError}</p>}
      <div className="dialog-actions"><button className="secondary-action" type="button" disabled={openingAdjustBusy} onClick={() => setOpeningAdjustOpen(false)}>إلغاء</button><button className="primary-action" type="button" disabled={openingAdjustBusy || openingAdjustCash === ''} onClick={saveOpeningAdjust}>{openingAdjustBusy ? 'جارٍ الحفظ…' : 'حفظ رصيد الافتتاح'}</button></div>
    </div></div>}

    {diagnosticOpen && <div className="overlay"><div className="dialog operational-day-dialog end-day-diagnostic-dialog" dir="rtl">
      <h2>فحص المزامنة</h2>
      {!diagnosticReport && <>
        <p>هذا التقرير للقراءة فقط ولا يغيّر المبيعات أو الطابور.</p>
        <label>رمز النظام<input autoFocus type="password" inputMode="numeric" value={diagnosticCode} onChange={event => setDiagnosticCode(event.target.value)} /></label>
        {diagnosticError && <p className="form-error" role="alert">{diagnosticError}</p>}
        <div className="dialog-actions"><button className="secondary-action" type="button" onClick={() => setDiagnosticOpen(false)}>إلغاء</button>{diagnosticAuthorized && <button className="secondary-action" type="button" disabled={recoveryExportBusy} onClick={exportRecoverySnapshot}>{recoveryExportBusy ? 'جارٍ التصدير…' : 'تصدير نسخة الاستعادة'}</button>}<button className="primary-action" type="button" disabled={diagnosticBusy} onClick={runDiagnostic}>{diagnosticBusy ? 'جارٍ القراءة…' : 'فتح التشخيص'}</button></div>
      </>}
      {diagnosticReport && <>
        <div className="diagnostic-runtime" aria-label="قيم حارس إنهاء اليوم">
          <span>preCloseGuard.status <b>{diagnosticReport.status}</b></span>
          <span>preCloseGuard.message <b>{diagnosticReport.message || '—'}</b></span>
          <span>LIVE_COMMIT <b>{diagnosticReport.LIVE_COMMIT || '—'}</b></span>
          <span>LIVE_BUNDLE <b>{diagnosticReport.LIVE_BUNDLE || '—'}</b></span>
          <span>businessDate <b>{diagnosticReport.businessDate || '—'}</b></span>
          <span>operationalDayId <b>{diagnosticReport.operationalDayId || '—'}</b></span>
          <span>localActiveCount <b>{diagnosticReport.localActiveCount}</b></span>
          <span>localActiveTotal <b>{diagnosticReport.localActiveTotal}</b></span>
          <span>firebaseActiveCount <b>{diagnosticReport.firebaseActiveCount}</b></span>
          <span>firebaseActiveTotal <b>{diagnosticReport.firebaseActiveTotal}</b></span>
          <span>pendingSaleWrite <b>{diagnosticReport.pendingSaleWrite}</b></span>
          <span>pendingVoidUpdate <b>{diagnosticReport.pendingVoidUpdate}</b></span>
          <span>voidedBeforeSyncResolved <b>{diagnosticReport.voidedBeforeSyncResolved}</b></span>
          <span>queueItems <b>{diagnosticReport.queueItems}</b></span>
          <span>blockingItems <b>{diagnosticReport.blockingItems}</b></span>
          <span>pendingQueue <b>{diagnosticReport.pendingQueue}</b></span>
          <span>openOrderFlag <b>{String(diagnosticReport.openOrderFlag)}</b></span>
          <span>END_DAY_READY <b>{diagnosticReport.END_DAY_READY || 'NO'}</b></span>
          <span>reconciliation <b>{diagnosticReport.reconciliationState}</b></span>
        </div>
        {(diagnosticReport.blockers || []).map(blocker => <article className="diagnostic-blocker" key={`${blocker.saleId}|${blocker.operationKey}`}>
          <h3>طلب {blocker.orderNumber || '—'} · {blocker.source}</h3>
          <dl>
            <dt>saleId</dt><dd>{blocker.saleId || '—'}</dd><dt>businessDate</dt><dd>{blocker.businessDate || '—'}</dd><dt>operationalDayId</dt><dd>{blocker.operationalDayId || '—'}</dd><dt>operationKey</dt><dd>{blocker.operationKey || '—'}</dd><dt>local status</dt><dd>{blocker.localStatus || '—'}</dd><dt>local syncStatus</dt><dd>{blocker.localSyncStatus || '—'}</dd><dt>centralVerified</dt><dd>{String(blocker.centralVerified)}</dd><dt>queueEntryExists</dt><dd>{String(blocker.queueEntryExists)}</dd><dt>centralExists</dt><dd>{String(blocker.centralExists)}</dd><dt>central status</dt><dd>{blocker.centralStatus || '—'}</dd><dt>central syncStatus</dt><dd>{blocker.centralSyncStatus || '—'}</dd><dt>salePayloadMatches</dt><dd>{String(blocker.salePayloadMatches)}</dd><dt>mismatchFields</dt><dd>{blocker.mismatchFields.length ? blocker.mismatchFields.join(', ') : '—'}</dd></dl>
          {blocker.queueEntries?.map(entry => <p className="diagnostic-queue" key={`${entry.id}|${entry.operationType}`}>queue: {entry.operationType} · {entry.id} · {entry.businessDate} · {entry.operationalDayId}</p>)}
        </article>)}
        {diagnosticReport.blockers?.length === 0 && <p role="status">لا توجد مبيعات حالية محسوبة كمانع.</p>}
        {diagnosticError && <p className="form-error" role="alert">{diagnosticError}</p>}
        <div className="dialog-actions"><button className="secondary-action" type="button" onClick={() => setDiagnosticOpen(false)}>إغلاق</button><button className="secondary-action" type="button" disabled={recoveryExportBusy} onClick={exportRecoverySnapshot}>{recoveryExportBusy ? 'جارٍ التصدير…' : 'تصدير نسخة الاستعادة'}</button><button className="primary-action" type="button" onClick={copyDiagnostic}>{diagnosticCopied ? 'تم النسخ' : 'نسخ تقرير التشخيص'}</button></div>
        {recoveryExported && <p role="status">تم تصدير: {recoveryExported}</p>}
      </>}
    </div></div>}

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
        {pendingTableCount > 0 && <p className="pending-day-warning" role="note">توجد طاولات معلقة غير مدفوعة، سيتم إبقاؤها في قسم الطاولات المعلقة ولا تُحسب ضمن المبيعات</p>}
        <div className="operational-day-summary">
          {preCloseGuard?.allowed === false && <p className="form-error" role="alert">{preCloseGuard.message || 'فشل تحقق المطابقة المالية؛ لا يمكن إنهاء اليوم.'}</p>}
          <span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span>
          <span>إجمالي المبيعات <b>{money(summary.total)}</b></span>
           <span>الرصيد الافتتاحي <b>{displayMoney(safeSettlementPreview.openingCashBalance ?? safeSettlementPreview.openingBalance ?? day?.openingCashBalance)}</b></span>
           <span>مبيعات الكاش <b>{money(safeSettlementPreview.cashSales)}</b></span>
           <span>مبيعات إلكترونية <b>{money(safeSettlementPreview.electronicSales)}</b></span>
           <span>المصاريف <b>{money(safeSettlementPreview.expenses)}</b></span>
           <span>السحوبات <b>{money(safeSettlementPreview.withdrawals)}</b></span>
           <span>الرصيد المتوقع بالصندوق <b>{money(safeSettlementPreview.expectedClosingCash ?? (expectedCashOpening + toMoneyNumber(safeSettlementPreview.dailyCashMovement, 0)))}</b></span>
           {(safeSettlementPreview.openingCashBalance == null && safeSettlementPreview.openingBalance == null && day?.openingCashBalance == null) && <small role="note">تم احتساب المتوقع بافتراض رصيد بداية اليوم = 0</small>}
           <label className="settlement-actual-cash">أدخل الكاش الفعلي بالصندوق<input type="number" min="0" value={actualCash} onChange={event => setActualCash(event.target.value)} placeholder="أدخل الكاش الفعلي" /></label>
           <span>الكاش الفعلي <b>{hasActualCash(actualCash) ? money(actualCash) : ACTUAL_CASH_PENDING}</b></span>
           <span>الفرق <b>{endDayAnalysis.difference == null ? ACTUAL_CASH_PENDING : `${money(endDayAnalysis.difference)} ${differenceLabel(endDayAnalysis.difference)}`}</b></span>
           <span>صافي حركة الصندوق بعد خصم الرصيد الافتتاحي <b>{endDayAnalysis.netDrawerMovement == null ? ACTUAL_CASH_PENDING : money(endDayAnalysis.netDrawerMovement)}</b></span>
           <span>صافي مبيعات اليوم النقدية <b>{endDayAnalysis.netCashSalesFromDrawer == null ? ACTUAL_CASH_PENDING : money(endDayAnalysis.netCashSalesFromDrawer)}</b></span>
           <span>فرق المبيعات النقدية <b>{endDayAnalysis.cashSalesDifference == null ? ACTUAL_CASH_PENDING : `${money(endDayAnalysis.cashSalesDifference)} ${differenceLabel(endDayAnalysis.cashSalesDifference)}`}</b></span>
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => setEndOpen(false)}>رجوع</button>
          <button className="danger-button" type="button" disabled={busy || actualCash === '' || preCloseGuard?.loading || preCloseGuard?.allowed === false} aria-disabled={preCloseGuard?.allowed === false} onClick={end}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد التسوية وإنهاء اليوم'}</button>
        </div>
      </div>
    </div>}
  </section>
}
