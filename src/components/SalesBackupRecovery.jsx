import React, { useMemo, useState } from 'react'
import { formatMoney, formatNumber } from '../utils.js'
import { classifyBackupSale, ORDER_1309_NUMBER, ORDER_1309_SALE_ID, parseBackupSales, summarizeBackupSales } from '../services/backupSalesRecovery.js'

const DEFAULT_DATE = '2026-10-08'
const statusLabel = {
  EXISTS_EXACT_MATCH: 'موجودة مطابقة — لا كتابة Firebase',
  MISSING_SAFE_TO_RECOVER: 'مفقودة — مؤهلة للاسترداد اليدوي',
  CONFLICT: 'تعارض — مراجعة يدوية',
  SKIP: 'تخطي',
}

export default function SalesBackupRecovery({ adminUser, onInspect, onMarkLocal, onRecover, canRecover = false, canReadback = false }) {
  const [fileName, setFileName] = useState('')
  const [sales, setSales] = useState([])
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE)
  const [inspection, setInspection] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState(null)
  const [recoveryForm, setRecoveryForm] = useState({ name: adminUser?.displayName || '', code: '', reason: '' })
  const summary = useMemo(() => summarizeBackupSales(sales), [sales])
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
        const parsed = parseBackupSales(reader.result)
        setSales(parsed)
        const preferred = parsed.some(sale => sale.businessDate === DEFAULT_DATE) ? DEFAULT_DATE : (parsed[0]?.businessDate || '')
        setSelectedDate(preferred)
      } catch (parseError) { setSales([]); setError(parseError.message || 'تعذر تحليل ملف النسخة الاحتياطية.') }
      finally { setBusy(false) }
    }
    reader.onerror = () => { setBusy(false); setError('تعذر قراءة ملف النسخة الاحتياطية.') }
    reader.readAsText(file)
  }

  const inspect = async () => {
    if (!sales.length || busy) return
    setBusy(true); setError(''); setNotice('')
    try { setInspection(await onInspect({ sales })) }
    catch (inspectError) {
      setError(inspectError?.code === 'ADMIN_ROLE_REQUIRED' || inspectError?.code === 'PERMISSION_DENIED'
        ? 'الفحص المركزي يحتاج صلاحية مدير أو إدارة'
        : inspectError?.message || 'تعذر فحص Firebase المصادق عليه.')
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

  return <section className="settings-card backup-recovery-card" dir="rtl" aria-label="فحص واسترداد نسخة المبيعات">
    <div className="settings-card-heading"><div><h2>فحص واسترداد نسخة المبيعات</h2><p>الفحص متاح للجميع، لكن الاسترداد متوقف لحين موافقة صاحب النظام.</p></div><span className="settings-lock">فحص آمن فقط</span></div>
    <label className="backup-file-picker">اختيار ملف النسخة الاحتياطية<input type="file" accept="application/json,.json" onChange={chooseFile} disabled={busy} /><span>{fileName || 'اختر ملف JSON'}</span></label>
    {sales.length > 0 && <>
      <div className="backup-summary-grid"><span>عدد المبيعات <b>{formatNumber(summary.count)}</b></span><span>المجموع <b>{formatMoney(summary.total)}</b></span><span>synced <b>{formatNumber(summary.synced)}</b></span><span>pending <b>{formatNumber(summary.pending)}</b></span><span>voided <b>{formatNumber(summary.voided)}</b></span><span>غير موثق <b>{formatNumber(summary.unverified)}</b></span></div>
      <div className="backup-toolbar"><label>تاريخ العمل<select value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{dates.map(date => <option key={date} value={date}>{date}</option>)}</select></label><div className="backup-toolbar-actions"><button type="button" className="primary-action" onClick={inspect} disabled={busy}>{busy ? 'جارٍ الفحص…' : 'فحص Firebase'}</button><button type="button" className="secondary-action" onClick={copyInspectionReport} disabled={busy}>نسخ تقرير الفحص</button></div></div>
      <div className="financial-table-wrap backup-table-wrap"><table className="financial-table"><thead><tr><th>الطلب</th><th>saleId</th><th>الكاشير</th><th>المبلغ</th><th>الدفع</th><th>الحالة</th><th>centralVerified</th><th>النتيجة</th><th>إجراء</th></tr></thead><tbody>{visibleRows.map(sale => {
        const result = resultById.get(sale.saleId)
        const classification = result?.classification || '—'
        const isTargetReadback = Number(sale.orderNumber) === ORDER_1309_NUMBER && sale.saleId === ORDER_1309_SALE_ID
        return <tr key={`${sale.saleId}|${sale.orderNumber}`}><td>{sale.orderNumber || '—'}</td><td dir="ltr"><small>{sale.saleId || '—'}</small></td><td>{sale.cashierNameSnapshot || sale.cashierName || sale.seller || '—'}</td><td>{formatMoney(sale.total)}</td><td>{sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</td><td>{sale.syncStatus || sale.status || '—'}</td><td>{String(sale.centralVerified === true)}</td><td><span className={`backup-status backup-status-${classification.toLowerCase()}`}>{statusLabel[classification] || (inspection ? 'غير مفحوصة' : 'بانتظار الفحص')}</span></td><td>{canReadback && isTargetReadback && result?.classification === 'EXISTS_EXACT_MATCH' ? <button type="button" className="secondary-action" disabled={busy} onClick={() => markLocal(result)}>تحديث محلي فقط</button> : canRecover && result?.classification === 'MISSING_SAFE_TO_RECOVER' ? <button type="button" className="primary-action" disabled={busy} onClick={() => { setRecovery(result); setRecoveryForm({ name: adminUser?.displayName || '', code: '', reason: '' }) }}>استرداد هذه المبيعة</button> : 'موقوف حتى موافقة المالك'}</td></tr>
      })}</tbody></table></div>
    </>}
    {sales.length === 0 && <p className="settings-readonly">اختر نسخة مبيعات JSON لعرض ملخصها وفحصها.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {recovery && <div className="overlay"><form className="dialog backup-recovery-dialog" dir="rtl" onSubmit={submitRecovery}><h2>تأكيد استرداد المبيعة</h2><p>سيتم رفع هذه المبيعة مرة واحدة إلى Firebase بعد التأكد من عدم وجودها مركزياً.</p><dl><dt>رقم الطلب</dt><dd>{recovery.sale.orderNumber}</dd><dt>saleId</dt><dd dir="ltr">{recovery.sale.saleId}</dd><dt>الإجمالي</dt><dd>{formatMoney(recovery.sale.total)}</dd><dt>الدفع</dt><dd>{recovery.sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</dd></dl><label>اسم المسؤول<input required value={recoveryForm.name} onChange={event => setRecoveryForm(form => ({ ...form, name: event.target.value }))} /></label><label>رمز الاسترداد الإداري<input required type="password" inputMode="numeric" value={recoveryForm.code} onChange={event => setRecoveryForm(form => ({ ...form, code: event.target.value }))} /></label><label>سبب الاسترداد<textarea required value={recoveryForm.reason} onChange={event => setRecoveryForm(form => ({ ...form, reason: event.target.value }))} /></label><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setRecovery(null)} disabled={busy}>إلغاء</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'جارٍ التحقق والحفظ…' : 'تأكيد الاسترداد'}</button></div></form></div>}
  </section>
}
