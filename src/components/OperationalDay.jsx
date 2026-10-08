import React, { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { formatMoney, formatDateTime, formatNumber, formatTime } from '../utils.js'
import { verifySystemAdminCode } from '../services/systemAdminCode.js'
import { createRecoverySnapshot, downloadRecoverySnapshot } from '../services/recoverySnapshot.js'
import { calculateEndDayCashAnalysis, toMoneyNumber } from '../services/financialCenter.js'

const money = value => formatMoney(toMoneyNumber(value, 0))
const displayMoney = value => value === null || value === undefined || value === '' ? '—' : money(value)
const differenceLabel = value => value === null || value === undefined || value === '' ? '' : toMoneyNumber(value, 0) === 0 ? 'مطابق' : toMoneyNumber(value, 0) < 0 ? 'نقص' : 'زيادة'
const ACTUAL_CASH_PENDING = 'بانتظار إدخال الكاش الفعلي'
const normalizeCashInput = value => String(value || '')
  .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
  .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
  .replace(/[^0-9]/g, '')
const formatCashInput = value => value === '' ? '' : Number(value).toLocaleString('en-US', { numberingSystem: 'latn' })

export default function OperationalDay({ day = {}, summary = {}, settlementPreview = summary, preCloseGuard = null, pendingTableCount = 0, loading, error, onPrepareEnd, onPrepareStart, onStart, onSetOpeningCashBalance, onEnd, onReadDiagnostic, canViewDiagnostics = false }) {
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [shortageConfirmed, setShortageConfirmed] = useState(false)
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
  const differenceValue = endDayAnalysis.difference
  const differenceState = differenceValue == null ? 'pending' : toMoneyNumber(differenceValue, 0) === 0 ? 'matched' : toMoneyNumber(differenceValue, 0) < 0 ? 'shortage' : 'surplus'
  const shortageNeedsConfirmation = differenceState === 'shortage'
  const closeDisabled = busy || actualCash === '' || preCloseGuard?.loading || preCloseGuard?.allowed === false || (shortageNeedsConfirmation && !shortageConfirmed)

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
    setShortageConfirmed(false)
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
      `LOCAL_OPERATIONAL_DAY_ID=${report.LOCAL_OPERATIONAL_DAY_ID || ''}`,
      `LOCAL_BUSINESS_DATE=${report.LOCAL_BUSINESS_DATE || ''}`,
      `LOCAL_DAY_STATUS=${report.LOCAL_DAY_STATUS || ''}`,
      `CENTRAL_OPERATIONAL_DAY_ID=${report.CENTRAL_OPERATIONAL_DAY_ID || ''}`,
      `CENTRAL_BUSINESS_DATE=${report.CENTRAL_BUSINESS_DATE || ''}`,
      `CENTRAL_DAY_STATUS=${report.CENTRAL_DAY_STATUS || ''}`,
      `LOCAL_CENTRAL_DAY_MATCH=${report.LOCAL_CENTRAL_DAY_MATCH || 'FAIL'}`,
      `SALE_ALLOWED=${report.SALE_ALLOWED || 'NO'}`,
      `BLOCK_REASON=${report.BLOCK_REASON || ''}`,
      `businessDate=${report.businessDate || ''}`,
      `operationalDayId=${report.operationalDayId || ''}`,
      `localActiveCount=${report.localActiveCount ?? 0}`,
      `localActiveTotal=${report.localActiveTotal ?? 0}`,
      `firebaseActiveCount=${report.firebaseActiveCount ?? 0}`,
      `firebaseActiveTotal=${report.firebaseActiveTotal ?? 0}`,
      `LOCAL_ACTIVE_COUNT=${report.LOCAL_ACTIVE_COUNT ?? report.localActiveCount ?? 0}`,
      `LOCAL_ACTIVE_TOTAL=${report.LOCAL_ACTIVE_TOTAL ?? report.localActiveTotal ?? 0}`,
      `FIREBASE_ACTIVE_COUNT=${report.FIREBASE_ACTIVE_COUNT ?? report.firebaseActiveCount ?? 0}`,
      `FIREBASE_ACTIVE_TOTAL=${report.FIREBASE_ACTIVE_TOTAL ?? report.firebaseActiveTotal ?? 0}`,
      `LOCAL_FIREBASE_ACTIVE_MATCH=${report.LOCAL_FIREBASE_ACTIVE_MATCH || 'FAIL'}`,
      `pendingSaleWrite=${report.pendingSaleWrite ?? 0}`,
      `pendingVoidUpdate=${report.pendingVoidUpdate ?? 0}`,
      `PENDING_SALE_WRITE=${report.PENDING_SALE_WRITE ?? report.pendingSaleWrite ?? 0}`,
      `PENDING_VOID_UPDATE=${report.PENDING_VOID_UPDATE ?? report.pendingVoidUpdate ?? 0}`,
      `voidedBeforeSyncResolved=${report.voidedBeforeSyncResolved ?? 0}`,
      `queueItems=${report.queueItems ?? 0}`,
      `QUEUE_ITEMS=${report.QUEUE_ITEMS ?? report.queueItems ?? 0}`,
      `blockingItems=${report.blockingItems ?? 0}`,
      `END_DAY_READY=${report.END_DAY_READY || 'NO'}`,
      `pendingQueue=${report.pendingQueue}`,
      `OPEN_SALES_QUEUE_COUNT=${report.OPEN_SALES_QUEUE_COUNT ?? 0}`,
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
            {canViewDiagnostics && <button type="button" onClick={openDiagnostic}>فحص المزامنة</button>}
          </div>
        : <div className="operational-day-actions"><button className="primary-action operational-day-action" type="button" disabled={preCloseGuard?.loading || preCloseGuard?.allowed === false} onClick={openEnd}>إنهاء اليوم</button><button className="secondary-action operational-day-diagnostic-action" type="button" onClick={openOpeningAdjust}>تعديل رصيد الافتتاح</button>{canViewDiagnostics && <button className="secondary-action operational-day-diagnostic-action" type="button" onClick={openDiagnostic}>فحص المزامنة</button>}</div>}
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
          <span>LOCAL_OPERATIONAL_DAY_ID <b>{diagnosticReport.LOCAL_OPERATIONAL_DAY_ID || '—'}</b></span>
          <span>LOCAL_BUSINESS_DATE <b>{diagnosticReport.LOCAL_BUSINESS_DATE || '—'}</b></span>
          <span>LOCAL_DAY_STATUS <b>{diagnosticReport.LOCAL_DAY_STATUS || '—'}</b></span>
          <span>CENTRAL_OPERATIONAL_DAY_ID <b>{diagnosticReport.CENTRAL_OPERATIONAL_DAY_ID || '—'}</b></span>
          <span>CENTRAL_BUSINESS_DATE <b>{diagnosticReport.CENTRAL_BUSINESS_DATE || '—'}</b></span>
          <span>CENTRAL_DAY_STATUS <b>{diagnosticReport.CENTRAL_DAY_STATUS || '—'}</b></span>
          <span>LOCAL_CENTRAL_DAY_MATCH <b>{diagnosticReport.LOCAL_CENTRAL_DAY_MATCH || 'FAIL'}</b></span>
          <span>SALE_ALLOWED <b>{diagnosticReport.SALE_ALLOWED || 'NO'}</b></span>
          <span>BLOCK_REASON <b>{diagnosticReport.BLOCK_REASON || '—'}</b></span>
          <span>businessDate <b>{diagnosticReport.businessDate || '—'}</b></span>
          <span>operationalDayId <b>{diagnosticReport.operationalDayId || '—'}</b></span>
          <span>localActiveCount <b>{diagnosticReport.localActiveCount}</b></span>
          <span>localActiveTotal <b>{diagnosticReport.localActiveTotal}</b></span>
          <span>firebaseActiveCount <b>{diagnosticReport.firebaseActiveCount}</b></span>
          <span>firebaseActiveTotal <b>{diagnosticReport.firebaseActiveTotal}</b></span>
          <span>LOCAL_ACTIVE_COUNT <b>{diagnosticReport.LOCAL_ACTIVE_COUNT ?? diagnosticReport.localActiveCount}</b></span>
          <span>LOCAL_ACTIVE_TOTAL <b>{diagnosticReport.LOCAL_ACTIVE_TOTAL ?? diagnosticReport.localActiveTotal}</b></span>
          <span>FIREBASE_ACTIVE_COUNT <b>{diagnosticReport.FIREBASE_ACTIVE_COUNT ?? diagnosticReport.firebaseActiveCount}</b></span>
          <span>FIREBASE_ACTIVE_TOTAL <b>{diagnosticReport.FIREBASE_ACTIVE_TOTAL ?? diagnosticReport.firebaseActiveTotal}</b></span>
          <span>LOCAL_FIREBASE_ACTIVE_MATCH <b>{diagnosticReport.LOCAL_FIREBASE_ACTIVE_MATCH || 'FAIL'}</b></span>
          <span>pendingSaleWrite <b>{diagnosticReport.pendingSaleWrite}</b></span>
          <span>pendingVoidUpdate <b>{diagnosticReport.pendingVoidUpdate}</b></span>
          <span>PENDING_SALE_WRITE <b>{diagnosticReport.PENDING_SALE_WRITE ?? diagnosticReport.pendingSaleWrite}</b></span>
          <span>PENDING_VOID_UPDATE <b>{diagnosticReport.PENDING_VOID_UPDATE ?? diagnosticReport.pendingVoidUpdate}</b></span>
          <span>voidedBeforeSyncResolved <b>{diagnosticReport.voidedBeforeSyncResolved}</b></span>
          <span>queueItems <b>{diagnosticReport.queueItems}</b></span>
          <span>QUEUE_ITEMS <b>{diagnosticReport.QUEUE_ITEMS ?? diagnosticReport.queueItems}</b></span>
          <span>blockingItems <b>{diagnosticReport.blockingItems}</b></span>
          <span>pendingQueue <b>{diagnosticReport.pendingQueue}</b></span>
          <span>OPEN_SALES_QUEUE_COUNT <b>{diagnosticReport.OPEN_SALES_QUEUE_COUNT ?? 0}</b></span>
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
      <div className="dialog operational-day-dialog end-day-closing-dialog" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="end-day-title">
        <div className="end-day-modal-scroll">
          <header className="end-day-modal-header">
            <div>
              <span className="end-day-eyebrow">التسوية المالية</span>
              <h2 id="end-day-title">إنهاء اليوم التشغيلي</h2>
              <p>راجع التسوية المالية قبل إغلاق اليوم</p>
            </div>
            <div className="end-day-meta" aria-label="بيانات اليوم التشغيلي">
              <span><small>تاريخ اليوم التشغيلي</small><b dir="ltr">{day.businessDate}</b></span>
              <span><small>وقت البدء</small><b dir="ltr">{startedLabel}</b></span>
              <span><small>وقت الإغلاق الحالي</small><b dir="ltr">{formatDateTime(Date.now())}</b></span>
            </div>
          </header>

          {pendingTableCount > 0 && <p className="pending-day-warning" role="note">توجد طاولات معلقة غير مدفوعة، سيتم إبقاؤها في قسم الطاولات المعلقة ولا تُحسب ضمن المبيعات</p>}
          {preCloseGuard?.allowed === false && <p className="form-error end-day-guard-error" role="alert">{preCloseGuard.pendingQueue > 0 || preCloseGuard.validCurrentDayPendingSyncCount > 0 ? 'توجد عملية غير مكتملة، سيتم المحاولة تلقائيًا.' : (preCloseGuard.message || 'فشل تحقق المطابقة المالية؛ لا يمكن إنهاء اليوم.')}</p>}

          <section className="end-day-section" aria-labelledby="end-day-sales-title">
            <div className="end-day-section-heading"><div><span className="end-day-section-kicker">الأداء</span><h3 id="end-day-sales-title">ملخص المبيعات</h3></div><span className="end-day-section-icon">↗</span></div>
            <div className="sales-summary-grid">
              <div className="sales-summary-card"><span>عدد الطلبات</span><b className="end-day-number">{formatNumber(summary.count)}</b><small>طلب مكتمل</small></div>
              <div className="sales-summary-card"><span>إجمالي المبيعات</span><b className="end-day-number">{money(summary.total)}</b><small>إجمالي اليوم</small></div>
              <div className="sales-summary-card"><span>مبيعات الكاش</span><b className="end-day-number">{money(safeSettlementPreview.cashSales)}</b><small>نقدي</small></div>
              <div className="sales-summary-card"><span>المبيعات الإلكترونية</span><b className="end-day-number">{money(safeSettlementPreview.electronicSales)}</b><small>إلكتروني</small></div>
            </div>
          </section>

          <section className="end-day-section settlement-section" aria-labelledby="end-day-settlement-title">
            <div className="end-day-section-heading"><div><span className="end-day-section-kicker">الأولوية</span><h3 id="end-day-settlement-title">تسوية الصندوق</h3></div><span className="settlement-badge">أساسي</span></div>
            <div className="settlement-formula" aria-label="معادلة الرصيد المتوقع"><span>الرصيد الافتتاحي</span><b>+</b><span>مبيعات الكاش</span><b>−</b><span>المصاريف</span><b>−</b><span>السحوبات</span><b>=</b><span>الرصيد المتوقع</span></div>
            <div className="settlement-list">
              <div className="settlement-row"><span>الرصيد الافتتاحي</span><strong className="end-day-number">{displayMoney(safeSettlementPreview.openingCashBalance ?? safeSettlementPreview.openingBalance ?? day?.openingCashBalance)}</strong></div>
              <div className="settlement-row"><span>مبيعات الكاش</span><strong className="end-day-number">{money(safeSettlementPreview.cashSales)}</strong></div>
              <div className="settlement-row"><span>المصاريف</span><strong className="end-day-number">{money(safeSettlementPreview.expenses)}</strong></div>
              <div className="settlement-row"><span>السحوبات</span><strong className="end-day-number">{money(safeSettlementPreview.withdrawals)}</strong></div>
              <div className="settlement-row expected"><span>الرصيد المتوقع بالصندوق</span><strong className="end-day-number">{money(safeSettlementPreview.expectedClosingCash ?? (expectedCashOpening + toMoneyNumber(safeSettlementPreview.dailyCashMovement, 0)))}</strong></div>
            </div>
            <p className="settlement-explanation">الرصيد المتوقع = الرصيد الافتتاحي + مبيعات الكاش - المصاريف - السحوبات</p>
            {(safeSettlementPreview.openingCashBalance == null && safeSettlementPreview.openingBalance == null && day?.openingCashBalance == null) && <small className="settlement-note" role="note">تم احتساب المتوقع بافتراض رصيد بداية اليوم = 0</small>}
          </section>

          <section className="end-day-section actual-cash-section" aria-labelledby="actual-cash-title">
            <div className="actual-cash-heading"><div><span className="end-day-section-kicker">التحقق الفعلي</span><h3 id="actual-cash-title">أدخل الكاش الفعلي بالصندوق</h3></div><span className="actual-cash-required">مطلوب</span></div>
            <label className="actual-cash-input-block"><span>المبلغ الموجود فعليًا عند الإغلاق</span><input type="text" inputMode="numeric" pattern="[0-9٠-٩, ]*" dir="ltr" value={formatCashInput(actualCash)} onChange={event => { setActualCash(normalizeCashInput(event.target.value)); setShortageConfirmed(false) }} placeholder="مثال: 106500" aria-label="الكاش الفعلي بالصندوق" /><small>اكتب المبلغ بالأرقام، وسيُحدَّث الفرق مباشرة.</small></label>
          </section>

          <section className={`difference-card difference-${differenceState}`} aria-live="polite" role={differenceState === 'shortage' ? 'alert' : 'status'}>
            <div className="difference-card-icon">{differenceState === 'matched' ? '✓' : differenceState === 'shortage' ? '!' : differenceState === 'surplus' ? '↑' : '—'}</div>
            <div className="difference-card-content">
              {differenceState === 'pending' && <><span className="difference-card-title">نتيجة التسوية</span><strong>{ACTUAL_CASH_PENDING}</strong></>}
              {differenceState === 'matched' && <><span className="difference-card-title">الصندوق مطابق</span><strong>لا يوجد فرق</strong></>}
              {differenceState === 'shortage' && <><span className="difference-card-title">نقص بالصندوق</span><strong className="end-day-number">{money(Math.abs(toMoneyNumber(differenceValue, 0)))} <em>نقص</em></strong></>}
              {differenceState === 'surplus' && <><span className="difference-card-title">زيادة بالصندوق</span><strong className="end-day-number">{money(Math.abs(toMoneyNumber(differenceValue, 0)))} <em>زيادة</em></strong></>}
            </div>
          </section>
          {shortageNeedsConfirmation && <label className="shortage-confirmation"><input type="checkbox" checked={shortageConfirmed} onChange={event => setShortageConfirmed(event.target.checked)} /><span>أؤكد وجود نقص بالصندوق وأريد إغلاق اليوم</span></label>}

          <section className="end-day-section net-movement-section" aria-labelledby="net-movement-title">
            <div className="end-day-section-heading"><div><span className="end-day-section-kicker">تفاصيل إضافية</span><h3 id="net-movement-title">حركة الصندوق</h3></div></div>
            <div className="net-movement-grid">
              <div><span>صافي حركة الصندوق بعد خصم الرصيد الافتتاحي</span><strong className="end-day-number">{endDayAnalysis.netDrawerMovement == null ? ACTUAL_CASH_PENDING : money(endDayAnalysis.netDrawerMovement)}</strong></div>
              <div><span>صافي مبيعات اليوم النقدية</span><strong className="end-day-number">{endDayAnalysis.netCashSalesFromDrawer == null ? ACTUAL_CASH_PENDING : money(endDayAnalysis.netCashSalesFromDrawer)}</strong></div>
              <div><span>فرق المبيعات النقدية</span><strong className="end-day-number">{endDayAnalysis.cashSalesDifference == null ? ACTUAL_CASH_PENDING : `${money(endDayAnalysis.cashSalesDifference)} ${differenceLabel(endDayAnalysis.cashSalesDifference)}`}</strong></div>
            </div>
          </section>
        </div>
        <div className="dialog-actions end-day-action-row">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => setEndOpen(false)}>رجوع</button>
          <button className={`end-day-close-button ${shortageNeedsConfirmation ? 'is-shortage' : ''}`} type="button" disabled={closeDisabled} aria-disabled={closeDisabled || preCloseGuard?.allowed === false} onClick={end}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد التسوية وإنهاء اليوم'}</button>
        </div>
      </div>
    </div>}
  </section>
}
