import React, { useMemo, useState } from 'react'
import { formatMoney, formatNumber } from '../utils.js'
import { classifyBackupSale, ORDER_1309_NUMBER, ORDER_1309_SALE_ID, parseBackupRecoveryInput, parseBackupSales, summarizeBackupSales } from '../services/backupSalesRecovery.js'

const DEFAULT_DATE = '2026-10-08'
const statusLabel = {
  EXISTS_EXACT_MATCH: 'موجودة مطابقة — لا كتابة Firebase',
  MISSING_SAFE_TO_RECOVER: 'مفقودة — مؤهلة للاسترداد اليدوي',
  CONFLICT: 'تعارض — مراجعة يدوية',
  SKIP: 'تخطي',
  LOCAL_ONLY: 'تحليل محلي فقط',
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
  const summary = useMemo(() => summarizeBackupSales(sales), [sales])
  const hasInspectionContent = sales.length > 0 || repairInput.syncQueueItems.length > 0
  const dates = useMemo(() => summary.days.map(day => day.businessDate), [summary.days])
  const visibleRows = useMemo(() => sales.filter(sale => !selectedDate || sale.businessDate === selectedDate), [sales, selectedDate])
  const resultById = useMemo(() => new Map((inspection?.results || []).map(result => [result.sale.saleId, result])), [inspection])
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
      const outcome = await onInspect({ sales })
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
      setInspection(await onInspect({ sales }))
    } catch (recoverError) { setError(recoverError?.message || 'تعذر استرداد المبيعة.') }
    finally { setBusy(false) }
  }

  const submitOneClickRepair = async event => {
    event.preventDefault()
    if (!recovery || recovery.mode !== 'one-click' || busy || !onRepair) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await onRepair({ sales, syncQueueItems: repairInput.syncQueueItems, businessDate: repairInput.businessDate || selectedDate, operationalDayId: repairInput.operationalDayId, sourceFile: fileName, recoveredByName: recoveryForm.name, recoveryCode: recoveryForm.code, recoveryReason: recoveryForm.reason })
      setRepairReport(outcome)
      setNotice('تم إصلاح المزامنة بأمان. يمكن فحص إنهاء اليوم الآن.')
      setRecovery(null); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' })
      setInspection(await onInspect({ sales }))
    } catch (repairError) { setError(repairError?.message || 'تعذر إصلاح المزامنة.') }
    finally { setBusy(false) }
  }

  return <section className="settings-card backup-recovery-card" dir="rtl" aria-label="فحص واسترداد نسخة المبيعات">
    <div className="settings-card-heading"><div><h2>فحص واسترداد نسخة المبيعات</h2><p>الفحص وقراءة ملف النسخة متاحان للجميع ولا يكتبان أي بيانات.</p><p>الإصلاح والاسترداد يتطلبان موافقة الإدارة ولا يعملان تلقائيًا.</p></div><span className="settings-lock">فحص آمن أولاً</span></div>
    <label className="backup-file-picker">اختيار ملف النسخة الاحتياطية<input type="file" accept="application/json,.json" onChange={chooseFile} disabled={busy} /><span>{fileName || 'اختر ملف JSON'}</span></label>
    {hasInspectionContent && <>
      <div className="backup-summary-grid"><span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span><span>المجموع <b>{formatMoney(summary.total)}</b></span><span>synced <b>{formatNumber(summary.synced)}</b></span><span>pending <b>{formatNumber(summary.pending)}</b></span><span>voided <b>{formatNumber(summary.voided)}</b></span><span>غير موثق <b>{formatNumber(summary.unverified)}</b></span></div>
      <div className="settings-readonly">عناصر syncQueue: <b>{formatNumber(repairInput.syncQueueItems.length)}</b>{repairInput.syncQueueItems.length > 0 && <ul>{repairInput.syncQueueItems.map((item, index) => { const row = item?.sale || item?.payload || item; return <li key={`${row?.saleId || row?.orderNumber || index}-${index}`}>order {row?.orderNumber || '—'} · saleId {row?.saleId || row?.id || '—'} · {formatMoney(row?.total ?? row?.subtotal ?? 0)} · {row?.businessDate || repairInput.businessDate || '—'} · {row?.operationalDayId || repairInput.operationalDayId || '—'}</li> })}</ul>}</div>
      <div className="backup-toolbar"><label>تاريخ العمل<select value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{dates.map(date => <option key={date} value={date}>{date}</option>)}</select></label><div className="backup-toolbar-actions"><button type="button" className="primary-action" onClick={inspect} disabled={busy}>{busy ? 'جارٍ الفحص…' : 'فحص Firebase'}</button><button type="button" className="secondary-action" onClick={copyInspectionReport} disabled={busy}>نسخ تقرير الفحص</button><button type="button" className="primary-action" onClick={() => { if (!canRepair) { setNotice('تم الفحص، لكن الإصلاح يحتاج صلاحية إدارة.'); return }; setRecovery({ mode: 'one-click' }); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' }) }} disabled={busy}>إصلاح المزامنة وتنظيف التكرار</button></div></div>
      {!canRepair && <p className="settings-readonly" role="status">تم الفحص، لكن الإصلاح يحتاج صلاحية إدارة.</p>}
      <div className="financial-table-wrap backup-table-wrap"><table className="financial-table"><thead><tr><th>الطلب</th><th>saleId</th><th>الكاشير</th><th>المبلغ</th><th>الدفع</th><th>الحالة</th><th>centralVerified</th><th>النتيجة</th><th>إجراء</th></tr></thead><tbody>{visibleRows.map(sale => {
        const result = resultById.get(sale.saleId)
        const classification = result?.classification || '—'
        const isTargetReadback = Number(sale.orderNumber) === ORDER_1309_NUMBER && sale.saleId === ORDER_1309_SALE_ID
        return <tr key={`${sale.saleId}|${sale.orderNumber}`}><td>{sale.orderNumber || '—'}</td><td dir="ltr"><small>{sale.saleId || '—'}</small></td><td>{sale.cashierNameSnapshot || sale.cashierName || sale.seller || '—'}</td><td>{formatMoney(sale.total)}</td><td>{sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</td><td>{sale.syncStatus || sale.status || '—'}</td><td>{String(sale.centralVerified === true)}</td><td><span className={`backup-status backup-status-${classification.toLowerCase()}`}>{statusLabel[classification] || (inspection ? 'غير مفحوصة' : 'بانتظار الفحص')}</span></td><td>{canReadback && isTargetReadback && result?.classification === 'EXISTS_EXACT_MATCH' ? <button type="button" className="secondary-action" disabled={busy} onClick={() => markLocal(result)}>تحديث محلي فقط</button> : canRecover && result?.classification === 'MISSING_SAFE_TO_RECOVER' ? <button type="button" className="primary-action" disabled={busy} onClick={() => { setRecovery(result); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' }) }}>استرداد هذه المبيعة</button> : 'موقوف حتى موافقة المالك'}</td></tr>
      })}</tbody></table></div>
    </>}
    {!hasInspectionContent && <p className="settings-readonly">اختر ملف JSON لعرض تحليله المحلي وفحصه.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {repairReport && <div className="settings-notice" role="status">نتيجة الإصلاح: readback فقط {repairReport.readbackOnly?.length || 0}، استرداد مرة واحدة {repairReport.recoveredOnce?.length || 0}، التكرارات المعالجة {repairReport.queueItemsResolved || 0}، التعارضات {repairReport.conflicts?.length || 0}، العناصر غير الصالحة {repairReport.invalidQueueItems?.length || 0}، المتبقي {repairReport.activeSyncQueueLengthAfter ?? '—'}، جاهزية إنهاء اليوم {repairReport.endDayReady ? 'نعم' : 'لا'}.</div>}
    {recovery && <div className="overlay"><form className="dialog backup-recovery-dialog" dir="rtl" onSubmit={recovery.mode === 'one-click' ? submitOneClickRepair : submitRecovery}><h2>{recovery.mode === 'one-click' ? 'تأكيد إصلاح المزامنة' : 'تأكيد استرداد المبيعة'}</h2>{recovery.mode === 'one-click' ? <><p>سيتم فحص Firebase أولاً، وتحديث readback المحلي للمطابق فقط، واسترداد المبيعات المفقودة المؤهلة مرة واحدة فقط.</p><dl><dt>مبيعات الملف</dt><dd>{summary.count}</dd><dt>الإجمالي</dt><dd>{formatMoney(summary.total)}</dd><dt>غير موثقة</dt><dd>{summary.unverified}</dd><dt>عناصر الطابور في الملف</dt><dd>{repairInput.syncQueueItems.length}</dd></dl><p className="settings-readonly">لن يتم تكرار أي طلب، وسيتم الفحص المركزي قبل أي كتابة. الطلب 1309 و1056 وأي يوم مغلق خارج الإصلاح.</p></> : <><p>سيتم رفع هذه المبيعة مرة واحدة إلى Firebase بعد التأكد من عدم وجودها مركزياً.</p><dl><dt>رقم الطلب</dt><dd>{recovery.sale.orderNumber}</dd><dt>saleId</dt><dd dir="ltr">{recovery.sale.saleId}</dd><dt>الإجمالي</dt><dd>{formatMoney(recovery.sale.total)}</dd><dt>الدفع</dt><dd>{recovery.sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</dd></dl></>}<label>اسم المسؤول<input required value={recoveryForm.name} onChange={event => setRecoveryForm(form => ({ ...form, name: event.target.value }))} /></label><label>رمز الاسترداد الإداري<input required type="password" inputMode="numeric" value={recoveryForm.code} onChange={event => setRecoveryForm(form => ({ ...form, code: event.target.value }))} /></label><label>سبب الاسترداد<textarea required value={recoveryForm.reason} onChange={event => setRecoveryForm(form => ({ ...form, reason: event.target.value }))} /></label><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setRecovery(null)} disabled={busy}>إلغاء</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'جارٍ التحقق والحفظ…' : (recovery.mode === 'one-click' ? 'تأكيد إصلاح المزامنة' : 'تأكيد الاسترداد')}</button></div></form></div>}
  </section>
}
