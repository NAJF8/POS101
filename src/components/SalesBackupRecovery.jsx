import React, { useMemo, useState } from 'react'
import { formatMoney, formatNumber } from '../utils.js'
import { classifyBackupSale, DEFAULT_REPAIR_RESULT, normalizeRepairResult, ORDER_1309_NUMBER, ORDER_1309_SALE_ID, parseBackupRecoveryInput, parseBackupSales, summarizeBackupSales } from '../services/backupSalesRecovery.js'
import { TEMP_OPEN_ONE_BUTTON_REPAIR } from '../services/posCentralSync.js'

const DEFAULT_DATE = '2026-10-08'
const statusLabel = {
  EXISTS_EXACT_MATCH: 'موجودة مطابقة — لا كتابة Firebase',
  MISSING_SAFE_TO_RECOVER: 'مفقودة — مؤهلة للاسترداد اليدوي',
  CONFLICT: 'تعارض — مراجعة يدوية',
  SKIP: 'تخطي',
  LOCAL_ONLY: 'تحليل محلي فقط',
}
const openRepairStatus = classification => ({
  EXISTS_EXACT_MATCH: 'تمت المطابقة',
  MISSING_SAFE_TO_RECOVER: 'استرداد آمن مرة واحدة',
  CONFLICT: 'تعارض للمراجعة',
  SKIP: 'جاهز للإصلاح',
  LOCAL_ONLY: 'جاهز للإصلاح',
}[classification] || 'جاهز للإصلاح')

const logRepairDiagnostic = result => {
  const safe = normalizeRepairResult(result)
  console.log('POS101_TRUE_ONE_BUTTON_REPAIR_RESULT', {
    ok: safe.ok === true,
    businessDate: safe.businessDate,
    readbackOnlyCount: safe.readbackOnly.length,
    recoveredOnceCount: safe.recoveredOnce.length,
    localPendingVerifiedFixed: safe.localPendingVerifiedFixed,
    duplicateQueueResolvedCount: safe.duplicateQueueResolved.length,
    conflictsCount: safe.conflicts.length,
    invalidQueueItemsCount: safe.invalidQueueItems.length,
    queueAfter: safe.activeSyncQueueLengthAfter,
    endDayReady: safe.endDayReady,
    errorMessage: safe.error || '',
  })
}

export default function SalesBackupRecovery({ adminUser, onInspect, onMarkLocal, onRecover, onRepair, canRecover = false, canReadback = false, canRepair = false }) {
  const [fileName, setFileName] = useState('')
  const [sales, setSales] = useState([])
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE)
  const [inspection, setInspection] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState(null)
  const [repairInput, setRepairInput] = useState({ syncQueueItems: [], businessDate: '', operationalDayId: '' })
  const [repairReport, setRepairReport] = useState(null)
  const [recoveryForm, setRecoveryForm] = useState({ name: adminUser?.displayName || '', code: '', reason: '' })
  const safeResult = useMemo(() => normalizeRepairResult(repairReport), [repairReport])
  const summary = useMemo(() => summarizeBackupSales(sales), [sales])
  const hasInspectionContent = sales.length > 0 || repairInput.syncQueueItems.length > 0
  const dates = useMemo(() => summary.days.map(day => day.businessDate), [summary.days])
  const visibleRows = useMemo(() => sales.filter(sale => !selectedDate || sale.businessDate === selectedDate), [sales, selectedDate])
  const resultById = useMemo(() => new Map((Array.isArray(inspection?.results) ? inspection.results : []).filter(result => result?.sale?.saleId).map(result => [result.sale.saleId, result])), [inspection])
  const reportSale = useMemo(() => sales.find(sale => Number(sale.orderNumber) === ORDER_1309_NUMBER) || sales.find(sale => sale.syncStatus === 'pending' || sale.centralVerified !== true), [sales])

  const chooseFile = event => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setError(''); setNotice(''); setInspection(null); setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseBackupRecoveryInput(reader.result)
        setRepairInput(parsed)
        setRepairReport(null)
        setSales(parsed.sales)
        const preferred = parsed.sales.some(sale => sale.businessDate === DEFAULT_DATE) ? DEFAULT_DATE : (parsed.businessDate || parsed.sales[0]?.businessDate || '')
        setSelectedDate(preferred)
      } catch (parseError) { setSales([]); setError(parseError.message || 'تعذر تحليل ملف النسخة الاحتياطية.') }
      finally { setBusy(false) }
    }
    reader.onerror = () => { setBusy(false); setError('تعذر قراءة ملف النسخة الاحتياطية.') }
    reader.readAsText(file)
  }

  const inspect = async () => {
    if (!hasInspectionContent || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await onInspect({ sales, syncQueueItems: repairInput.syncQueueItems })
      setInspection(outcome)
      if (outcome?.centralAvailable === false) setNotice('الفحص المركزي يحتاج صلاحية، لم يتم تنفيذ مزامنة.')
    }
    catch (inspectError) {
      setNotice('الفحص المركزي يحتاج صلاحية، لم يتم تنفيذ مزامنة.')
    }
    finally { setBusy(false) }
  }

  const copyInspectionReport = async () => {
    const pending = sales.filter(sale => sale.syncStatus === 'pending' || sale.centralVerified !== true)
    const selectedResult = reportSale ? resultById.get(reportSale.saleId) : null
    const selectedDetails = reportSale
      ? [`selectedOrder=${reportSale.orderNumber || ''}`, `selectedSaleId=${reportSale.saleId || ''}`, `selectedTotal=${reportSale.total || 0}`, `selectedPaymentMethod=${reportSale.paymentMethod || ''}`, `selectedBusinessDate=${reportSale.businessDate || ''}`, `selectedOperationalDayId=${reportSale.operationalDayId || ''}`, `selectedClassification=${selectedResult?.classification || 'not-inspected'}`]
      : ['selectedSale=none']
    const report = [
      'POS101 BACKUP INSPECTION REPORT',
      `businessDate=${selectedDate || ''}`,
      `count=${sales.length}`,
      `total=${summary.total}`,
      `pendingCount=${pending.length}`,
      `pendingOrders=${pending.map(sale => sale.orderNumber || '').join(',')}`,
      `syncQueueCount=${repairInput.syncQueueItems.length}`,
      `syncQueueItems=${repairInput.syncQueueItems.map(item => `${item?.orderNumber || item?.sale?.orderNumber || ''}:${item?.saleId || item?.sale?.saleId || ''}:${item?.total || item?.sale?.total || ''}`).join('|')}`,
      ...selectedDetails,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(report)
      setNotice('تم نسخ تقرير الفحص لإرساله إلى صاحب النظام.')
    } catch { setError('تعذر نسخ التقرير. انسخه من بيانات الفحص أو اسمح بالوصول إلى الحافظة.') }
  }

  const markLocal = async result => {
    if (!result?.centralSale || !window.confirm('سيتم تحديث حالة هذه المبيعة محلياً فقط بعد تطابق Firebase. لن تتم كتابة Firebase. متابعة؟')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await onMarkLocal({ sale: result.sale, centralSale: result.centralSale })
      setNotice(outcome.updated ? 'تم تحديث readback المحلي فقط.' : 'المبيعة موجودة في Firebase لكنها غير موجودة محليًا؛ لا حاجة للاسترداد، وسيتم اعتماد Firebase في التقارير.')
    } catch (markError) { setError(markError?.message || 'تعذر تحديث الحالة المحلية.') }
    finally { setBusy(false) }
  }

  const submitRecovery = async event => {
    event.preventDefault()
    if (!recovery || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await onRecover({ sale: recovery.sale, recoverySourceFile: fileName, recoveredByName: recoveryForm.name, recoveryCode: recoveryForm.code, recoveryReason: recoveryForm.reason })
      setNotice(outcome.duplicate ? 'المبيعة كانت موجودة مسبقاً؛ لم تُكتب مرة ثانية.' : 'تم الاسترداد مع readback وسجل التدقيق.')
      setRecovery(null); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' })
      setInspection(await onInspect({ sales, syncQueueItems: repairInput.syncQueueItems }))
    } catch (recoverError) { setError(recoverError?.message || 'تعذر استرداد المبيعة.') }
    finally { setBusy(false) }
  }

  const submitOneClickRepair = async event => {
    event?.preventDefault?.()
    if (busy || !onRepair) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await onRepair({ sales, syncQueueItems: repairInput.syncQueueItems, businessDate: repairInput.businessDate || selectedDate, operationalDayId: repairInput.operationalDayId, sourceFile: fileName })
      const safeOutcome = normalizeRepairResult(outcome)
      setRepairReport(safeOutcome)
      logRepairDiagnostic(safeOutcome)
      setNotice('تم إصلاح المزامنة. لا توجد تكرارات مؤكدة، ويمكن فحص إنهاء اليوم.')
      setRecovery(null); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' })
      if (!TEMP_OPEN_ONE_BUTTON_REPAIR && onInspect) setInspection(await onInspect({ sales, syncQueueItems: repairInput.syncQueueItems }))
    } catch (repairError) {
      const message = repairError?.message || String(repairError || 'تعذر إصلاح المزامنة.')
      let activeQueueLength = null
      try { activeQueueLength = JSON.parse(localStorage.getItem('pos101.syncQueue') || '[]').length } catch {}
      const failureResult = { ...DEFAULT_REPAIR_RESULT, trueOneButtonRepair: 'FAIL', activeSyncQueueLengthAfter: activeQueueLength, syncLockBefore: repairError?.lockSafety?.lockBefore || repairError?.lock || null, syncLockAfter: repairError?.lockSafety?.lockAfter || repairError?.lock || null, syncLockCleared: Boolean(repairError?.lockSafety?.clearedStaleLock), error: message }
      setRepairReport(normalizeRepairResult(failureResult, message))
      logRepairDiagnostic(failureResult)
      setError(message)
      setNotice('تعذر إكمال الإصلاح التلقائي. انسخ التقرير وأرسله للمراجعة.')
    }
    finally { setBusy(false) }
  }

  return <section className="settings-card backup-recovery-card" dir="rtl" aria-label="فحص واسترداد نسخة المبيعات">
    <div className="settings-card-heading"><div><h2>فحص واسترداد نسخة المبيعات</h2><p>{TEMP_OPEN_ONE_BUTTON_REPAIR ? 'ارفع نسخة المبيعات واضغط زر الإصلاح التلقائي.' : 'الفحص وقراءة ملف النسخة متاحان للجميع ولا يكتبان أي بيانات.'}</p>{!TEMP_OPEN_ONE_BUTTON_REPAIR && <p>الإصلاح والاسترداد يتطلبان موافقة الإدارة ولا يعملان تلقائيًا.</p>}</div><span className="settings-lock">{TEMP_OPEN_ONE_BUTTON_REPAIR ? 'إصلاح تلقائي' : 'فحص آمن أولاً'}</span></div>
    <label className="backup-file-picker">اختيار ملف النسخة الاحتياطية<input type="file" accept="application/json,.json" onChange={chooseFile} disabled={busy} /><span>{fileName || 'اختر ملف JSON'}</span></label>
    {hasInspectionContent && <>
      <div className="backup-summary-grid"><span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span><span>المجموع <b>{formatMoney(summary.total)}</b></span><span>synced <b>{formatNumber(summary.synced)}</b></span><span>pending <b>{formatNumber(summary.pending)}</b></span><span>voided <b>{formatNumber(summary.voided)}</b></span><span>غير موثق <b>{formatNumber(summary.unverified)}</b></span></div>
      <div className="settings-readonly">عناصر syncQueue: <b>{formatNumber(repairInput.syncQueueItems.length)}</b>{repairInput.syncQueueItems.length > 0 && <ul>{repairInput.syncQueueItems.map((item, index) => { const row = item?.sale || item?.payload || item; return <li key={`${row?.saleId || row?.orderNumber || index}-${index}`}>order {row?.orderNumber || '—'} · saleId {row?.saleId || row?.id || '—'} · {formatMoney(row?.total ?? row?.subtotal ?? 0)} · {row?.businessDate || repairInput.businessDate || '—'} · {row?.operationalDayId || repairInput.operationalDayId || '—'}</li> })}</ul>}</div>
      <div className="backup-toolbar"><label>تاريخ العمل<select value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{dates.map(date => <option key={date} value={date}>{date}</option>)}</select></label><div className="backup-toolbar-actions">{TEMP_OPEN_ONE_BUTTON_REPAIR ? <button type="button" className="primary-action" onClick={submitOneClickRepair} disabled={busy}>{busy ? 'جاري إصلاح المزامنة وتنظيف التكرارات...' : 'إصلاح المزامنة تلقائيًا'}</button> : <><button type="button" className="primary-action" onClick={inspect} disabled={busy}>{busy ? 'جارٍ الفحص…' : 'فحص Firebase'}</button><button type="button" className="secondary-action" onClick={copyInspectionReport} disabled={busy}>نسخ تقرير الفحص</button><button type="button" className="primary-action" onClick={() => { if (!canRepair) { setNotice('تم الفحص، لكن الإصلاح يحتاج صلاحية إدارة.'); return }; setRecovery({ mode: 'one-click' }); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' }) }} disabled={busy}>إصلاح المزامنة وتنظيف التكرار</button></>}</div></div>
      {!TEMP_OPEN_ONE_BUTTON_REPAIR && !canRepair && <p className="settings-readonly" role="status">تم الفحص، لكن الإصلاح يحتاج صلاحية إدارة.</p>}
      <div className="financial-table-wrap backup-table-wrap"><table className="financial-table"><thead><tr><th>الطلب</th><th>saleId</th><th>الكاشير</th><th>المبلغ</th><th>الدفع</th><th>الحالة</th><th>centralVerified</th><th>النتيجة</th><th>إجراء</th></tr></thead><tbody>{visibleRows.map(sale => {
        const result = resultById.get(sale.saleId)
        const classification = result?.classification || '—'
        const isTargetReadback = Number(sale.orderNumber) === ORDER_1309_NUMBER && sale.saleId === ORDER_1309_SALE_ID
        return <tr key={`${sale.saleId}|${sale.orderNumber}`}><td>{sale.orderNumber || '—'}</td><td dir="ltr"><small>{sale.saleId || '—'}</small></td><td>{sale.cashierNameSnapshot || sale.cashierName || sale.seller || '—'}</td><td>{formatMoney(sale.total)}</td><td>{sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</td><td>{sale.syncStatus || sale.status || '—'}</td><td>{String(sale.centralVerified === true)}</td><td><span className={`backup-status backup-status-${classification.toLowerCase()}`}>{TEMP_OPEN_ONE_BUTTON_REPAIR ? openRepairStatus(classification) : (statusLabel[classification] || (inspection ? 'غير مفحوصة' : 'بانتظار الفحص'))}</span></td><td>{TEMP_OPEN_ONE_BUTTON_REPAIR ? (classification === 'CONFLICT' ? 'تعارض للمراجعة' : 'جاهز للإصلاح') : canReadback && isTargetReadback && result?.classification === 'EXISTS_EXACT_MATCH' ? <button type="button" className="secondary-action" disabled={busy} onClick={() => markLocal(result)}>تحديث محلي فقط</button> : canRecover && result?.classification === 'MISSING_SAFE_TO_RECOVER' ? <button type="button" className="primary-action" disabled={busy} onClick={() => { setRecovery(result); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' }) }}>استرداد هذه المبيعة</button> : 'موقوف حتى موافقة المالك'}</td></tr>
      })}</tbody></table></div>
    </>}
    {!hasInspectionContent && <p className="settings-readonly">اختر ملف JSON لعرض تحليله المحلي وفحصه.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {repairReport && <div className="settings-notice backup-repair-report" role="status">TRUE_ONE_BUTTON_REPAIR={safeResult.trueOneButtonRepair} · SYNC_LOCK_BEFORE={safeResult.syncLockBefore ? 'PRESENT' : 'NONE'} · SYNC_LOCK_CLEARED={safeResult.syncLockCleared ? 'YES' : 'NO'} · SYNC_LOCK_AFTER={safeResult.syncLockAfter ? 'PRESENT' : 'NONE'} · EMERGENCY_REPAIR_ACTIVE_USED={safeResult.emergencyRepairActiveUsed} · READBACK_ONLY={safeResult.readbackOnly.length} · LOCAL_PENDING_VERIFIED_FIXED={safeResult.localPendingVerifiedFixed} · RECOVERED_ONCE={safeResult.recoveredOnce.length} · QUEUE_ITEMS_RESOLVED={safeResult.queueItemsResolved.length} · DUPLICATE_QUEUE_RESOLVED={safeResult.duplicateQueueResolved.length} · CONFLICTS={safeResult.conflicts.length} · ACTIVE_SYNC_QUEUE_LENGTH_AFTER={safeResult.activeSyncQueueLengthAfter ?? '—'} · END_DAY_READY={safeResult.endDayReady === 'YES' || safeResult.endDayReady === true ? 'YES' : 'NO'}{safeResult.error ? ` · ERROR=${safeResult.error}` : ''}</div>}
    {!TEMP_OPEN_ONE_BUTTON_REPAIR && recovery && <div className="overlay"><form className="dialog backup-recovery-dialog" dir="rtl" onSubmit={recovery.mode === 'one-click' ? submitOneClickRepair : submitRecovery}><h2>{recovery.mode === 'one-click' ? 'تأكيد إصلاح المزامنة' : 'تأكيد استرداد المبيعة'}</h2>{recovery.mode === 'one-click' ? <><p>سيتم فحص Firebase أولاً، وتحديث readback المحلي للمطابق فقط، واسترداد المبيعات المفقودة المؤهلة مرة واحدة فقط.</p><dl><dt>مبيعات الملف</dt><dd>{summary.count}</dd><dt>الإجمالي</dt><dd>{formatMoney(summary.total)}</dd><dt>غير موثقة</dt><dd>{summary.unverified}</dd><dt>عناصر الطابور في الملف</dt><dd>{repairInput.syncQueueItems.length}</dd></dl><p className="settings-readonly">لن يتم تكرار أي طلب، وسيتم الفحص المركزي قبل أي كتابة. الطلب 1309 و1056 وأي يوم مغلق خارج الإصلاح.</p></> : <><p>سيتم رفع هذه المبيعة مرة واحدة إلى Firebase بعد التأكد من عدم وجودها مركزياً.</p><dl><dt>رقم الطلب</dt><dd>{recovery.sale.orderNumber}</dd><dt>saleId</dt><dd dir="ltr">{recovery.sale.saleId}</dd><dt>الإجمالي</dt><dd>{formatMoney(recovery.sale.total)}</dd><dt>الدفع</dt><dd>{recovery.sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</dd></dl></>}<label>اسم المسؤول<input required value={recoveryForm.name} onChange={event => setRecoveryForm(form => ({ ...form, name: event.target.value }))} /></label><label>رمز الاسترداد الإداري<input required type="password" inputMode="numeric" value={recoveryForm.code} onChange={event => setRecoveryForm(form => ({ ...form, code: event.target.value }))} /></label><label>سبب الاسترداد<textarea required value={recoveryForm.reason} onChange={event => setRecoveryForm(form => ({ ...form, reason: event.target.value }))} /></label><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setRecovery(null)} disabled={busy}>إلغاء</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'جارٍ التحقق والحفظ…' : (recovery.mode === 'one-click' ? 'تأكيد إصلاح المزامنة' : 'تأكيد الاسترداد')}</button></div></form></div>}
  </section>
}
