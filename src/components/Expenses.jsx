import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatDateTime } from '../utils.js'
import { getLocalDateKey, normalizeDateKey } from '../services/expenseReporting.js'
import { deleteCentralExpense, findOperationalDayByBusinessDate, readCentralExpensesForReports, readLocalExpenses, readLocalOperationalDay, runExpenseCentralSync, saveCentralExpense, saveCentralExpenseWithCashbox, saveCashboxTransaction, saveLocalExpensePending, subscribeCentralExpenses } from '../services/posCentralSync.js'
import { createExpenseRecoveryBackup, createMasterExpenseRecoveryHandler, parseManualExpenseBulk, recoverExpensesFromKnownBackups, scanAllExpenseBackups } from '../services/fullRecoveryController.js'

const format = formatMoney
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
const categories = ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'راتب', 'سحوبات', 'أخرى']
const people = ['علي', 'روان', 'محمد', 'ميس']

export function Expenses({ onNavigate, onBack, session, operationalDay = null, staff = [] }) {
  const effectiveOperationalDay = operationalDay?.status === 'open' ? operationalDay : readLocalOperationalDay()
  const [expenses, setExpenses] = useState(() => readLocalExpenses())
  const [centralCount, setCentralCount] = useState(null)
  const [centralExpenses, setCentralExpenses] = useState([])
  const [localCount, setLocalCount] = useState(() => readLocalExpenses().length)
  const [centralRefreshing, setCentralRefreshing] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const latest = readLocalExpenses()
      setExpenses(latest)
      setLocalCount(latest.length)
    }
    window.addEventListener('pos101-expenses-updated', refresh)
    const stop = subscribeCentralExpenses((merged, meta = {}) => {
      setExpenses(merged)
      setLocalCount(meta.localCount ?? readLocalExpenses().length)
      if (meta.centralCount !== undefined) setCentralCount(meta.centralCount)
      if (meta.centralExpenses) setCentralExpenses(meta.centralExpenses)
    })
    return () => { window.removeEventListener('pos101-expenses-updated', refresh); stop?.() }
  }, [])
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('مشتريات')
  const [person, setPerson] = useState('علي')
  const [personId, setPersonId] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [entryType, setEntryType] = useState('current')
  const [historicalDate, setHistoricalDate] = useState('')
  const [payFromCashbox, setPayFromCashbox] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recoveryScan, setRecoveryScan] = useState(null)
  const [selectedRecoveryIds, setSelectedRecoveryIds] = useState([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualText, setManualText] = useState('')
  const [masterRecoveryBusy, setMasterRecoveryBusy] = useState(false)
  const [masterRecoveryStatus, setMasterRecoveryStatus] = useState('')
  const [masterRecoveryResult, setMasterRecoveryResult] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const masterRecoveryHandler = useMemo(() => createMasterExpenseRecoveryHandler({ onStatus: setMasterRecoveryStatus }), [])

  const announceSuccess = message => {
    setSuccessMessage(message)
    window.setTimeout(() => setSuccessMessage(''), 3200)
  }

  const runMasterRecovery = async () => {
    if (masterRecoveryBusy) return
    setMasterRecoveryBusy(true)
    setMasterRecoveryResult(null)
    try {
      const result = await masterRecoveryHandler()
      if (result?.skipped) return
      setMasterRecoveryResult(result)
      const latest = readLocalExpenses()
      setExpenses(latest)
      setLocalCount(latest.length)
      setMasterRecoveryStatus('')
    } catch (error) {
      setMasterRecoveryStatus(error?.message || 'تعذر إكمال مزامنة واسترجاع المصاريف.')
    } finally { setMasterRecoveryBusy(false) }
  }

  const refreshCentralExpenses = async () => {
    if (centralRefreshing) return
    setCentralRefreshing(true)
    try {
      const result = await readCentralExpensesForReports({ includeAllLocal: true })
      setExpenses(result.expenses || [])
      setCentralCount(result.centralCount ?? null)
      setCentralExpenses(result.centralExpenses || [])
      setLocalCount(result.localCount ?? readLocalExpenses().length)
      setSyncMessage(`قراءة Firebase فقط: ${result.centralCount || 0} سجل مركزي، الدمج النهائي ${result.mergedCount || 0}.`)
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر قراءة المصاريف من Firebase.')
    } finally { setCentralRefreshing(false) }
  }

  const resetForm = () => { const activePerson = staff.find(row => row.active) || null; setEditingId(null); setAmount(''); setCategory('مشتريات'); setPerson(activePerson?.name || 'علي'); setPersonId(activePerson?.id || ''); setDescription(''); setNotes(''); setEntryType('current'); setHistoricalDate(''); setPayFromCashbox(false) }
  const syncNow = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncMessage('')
    try {
      let result
      try {
        result = await runExpenseCentralSync({ initial: true })
      } catch (error) {
        if (error?.code !== 'AUTH_REQUIRED') throw error
        throw error
      }
      setSyncMessage(`تمت المزامنة: رفع ${result?.uploaded || 0}، تخطي ${result?.skipped || 0}، الإجمالي المركزي ${result?.centralCount || 0}`)
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر تنفيذ المزامنة.')
    } finally {
      setSyncing(false)
    }
  }
  const recoverOldExpenses = async () => {
    if (recovering || syncing) return
    setRecovering(true)
    setSyncMessage('')
    try {
      const recovery = recoverExpensesFromKnownBackups()
      const localAfterRecovery = readLocalExpenses()
      setExpenses(localAfterRecovery)

      let syncResult = null
      if (recovery.recoveredCount > 0) {
        try {
          syncResult = await runExpenseCentralSync({ initial: true })
        } catch (error) {
          if (error?.code !== 'AUTH_REQUIRED') throw error
          throw error
        }
      }

      const sourceCount = recovery.sources?.length || 0
      const uploaded = syncResult?.uploaded || 0
      const centralCount = syncResult?.centralCount || 0
      if (recovery.recoveredCount > 0) {
        setSyncMessage(`تم الاسترجاع: ${recovery.recoveredCount} مصروف من ${sourceCount} نسخة احتياطية، وتم رفع ${uploaded}، والإجمالي المركزي ${centralCount}.`)
      } else {
        setSyncMessage(`تم فحص ${recovery.scannedBackups || 0} نسخة احتياطية محلية ولم يتم العثور على مصاريف إضافية قابلة للاسترجاع.`)
      }
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر استرجاع المصاريف القديمة.')
    } finally {
      setRecovering(false)
    }
  }
  const scanOldExpenses = () => {
    try {
      const result = scanAllExpenseBackups()
      setRecoveryScan(result)
      setSelectedRecoveryIds(result.candidates.map(row => row.id))
      setSyncMessage(`تم فحص ${result.scannedKeys} مفتاحًا محليًا واكتشاف ${result.newCount} سجل قابل للاسترجاع.`)
    } catch (error) { setSyncMessage(error?.message || 'تعذر فحص النسخ القديمة.') }
  }
  const recoverSelected = async () => {
    const selected = (recoveryScan?.candidates || []).filter(row => selectedRecoveryIds.includes(row.id))
    if (!selected.length) return setSyncMessage('اختر سجلًا واحدًا على الأقل من Preview.')
    setRecovering(true)
    try {
      createExpenseRecoveryBackup(selected)
      selected.forEach(row => saveLocalExpensePending(row))
      setExpenses(readLocalExpenses())
      let uploaded = 0; let pending = selected.length
      try {
        const result = await runExpenseCentralSync({ initial: true })
        uploaded = result?.uploaded || 0
        pending = readLocalExpenses().filter(row => row.syncStatus === 'pending').length
      } catch (error) {
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) throw error
      }
      setSyncMessage(`تمت معالجة الاسترجاع: مستعاد ${selected.length}، مرفوع ${uploaded}، Pending ${pending}، متكرر متخطى ${recoveryScan.duplicateCount}.`)
      setRecoveryScan(null); setSelectedRecoveryIds([])
    } catch (error) { setSyncMessage(error?.message || 'تعذر استرجاع المحدد.') }
    finally { setRecovering(false) }
  }
  const manualPreview = useMemo(() => parseManualExpenseBulk(manualText), [manualText])
  const saveManualBulk = async () => {
    const valid = manualPreview.filter(row => row.valid).map(row => row.expense)
    if (!valid.length) return setSyncMessage('لا توجد أسطر صحيحة للحفظ.')
    setRecovering(true)
    try {
      createExpenseRecoveryBackup(valid)
      valid.forEach(row => saveLocalExpensePending(row))
      setExpenses(readLocalExpenses())
      let uploaded = 0
      try { uploaded = (await runExpenseCentralSync({ initial: true }))?.uploaded || 0 } catch (error) {
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) throw error
      }
      const pending = readLocalExpenses().filter(row => row.syncStatus === 'pending').length
      setSyncMessage(`تم حفظ ${valid.length} مصروف يدوي، مرفوع ${uploaded}، Pending ${pending}.`)
      setManualText(''); setManualOpen(false)
    } catch (error) { setSyncMessage(error?.message || 'تعذر حفظ الاسترجاع اليدوي.') }
    finally { setRecovering(false) }
  }

  const submit = async e => {
    e.preventDefault()
    const numericAmount = Number(amount)
    const cleanDescription = description.trim()
    const cleanNotes = notes.trim()
    const todayKey = getLocalDateKey(Date.now())
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !cleanDescription) return alert('يرجى إدخال مبلغ ووصف صحيحين')
    if (entryType === 'historical' && (!normalizeDateKey(historicalDate) || historicalDate > todayKey)) return alert('اختر تاريخًا سابقًا صحيحًا، ولا يمكن اختيار تاريخ مستقبلي.')
    if (editingId) {
      if (category === 'سحوبات') return alert('لا يمكن تحويل مصروف محفوظ إلى سحب صندوق من شاشة المصاريف.')
      const current = expenses.find(row => row.id === editingId)
      let edited = current ? { ...current, amount: numericAmount, category, person, employeeId: personId || current.employeeId || '', notes: cleanNotes, description: cleanDescription } : null
      if (edited && entryType === 'historical') {
        if (historicalDate !== current?.businessDate && !window.confirm('سيتم نقل المصروف إلى تاريخ أعمال مختلف. هل تريد المتابعة؟')) return
        try {
          const match = await findOperationalDayByBusinessDate(historicalDate)
          edited = { ...edited, businessDate: historicalDate, operationalDayId: match.operationalDayId, entryType: 'historical', source: 'manual' }
          if (match.ambiguous) console.warn('HISTORICAL_OPERATIONAL_DAY_AMBIGUOUS', { businessDate: historicalDate, matchCount: match.matches.length })
        } catch (error) {
          if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) return alert(error?.message || 'تعذر مطابقة اليوم التشغيلي التاريخي.')
          edited = { ...edited, businessDate: historicalDate, operationalDayId: '', entryType: 'historical', source: 'manual' }
        }
      } else if (edited) edited = { ...edited, entryType: 'current', businessDate: current?.businessDate || effectiveOperationalDay?.businessDate || '' }
      try {
        await saveCentralExpense(edited, { existing: true })
        resetForm(); setFormOpen(false); announceSuccess('تم تعديل المصروف بنجاح')
      } catch (error) {
        if (error?.code === 'AUTH_REQUIRED' && edited) {
          saveLocalExpensePending(edited)
          resetForm(); setFormOpen(false); announceSuccess('تم حفظ التعديل محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
        } else alert(error?.message || 'تعذر مزامنة تعديل المصروف.')
      }
      return
    }
    if (entryType === 'current' && (effectiveOperationalDay?.status !== 'open' || !effectiveOperationalDay?.id || !effectiveOperationalDay?.businessDate)) {
      alert('يجب بدء يوم تشغيلي قبل تسجيل مصروف جديد حتى يُحسب المصروف ضمن نفس فترة العمل.')
      return
    }
    const createdAt = Date.now()
    let businessDate = effectiveOperationalDay?.businessDate || ''
    let operationalDayId = effectiveOperationalDay?.id || ''
    if (entryType === 'historical') {
      try {
        const match = await findOperationalDayByBusinessDate(historicalDate)
        operationalDayId = match.operationalDayId
        businessDate = historicalDate
        if (match.ambiguous) console.warn('HISTORICAL_OPERATIONAL_DAY_AMBIGUOUS', { businessDate, matchCount: match.matches.length })
      } catch (error) {
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) return alert(error?.message || 'تعذر مطابقة اليوم التشغيلي التاريخي.')
        operationalDayId = ''
        businessDate = historicalDate
      }
    }
    if (category === 'سحوبات') {
      try {
        await saveCashboxTransaction({
          type: 'withdrawal',
          category: 'سحوبات',
          amount: numericAmount,
          businessDate,
          operationalDayId,
          employeeId: personId || '',
          employeeNameSnapshot: person,
          cashierId: personId || '',
          reason: cleanDescription,
          description: cleanDescription,
          notes: cleanNotes,
          source: 'employee withdrawal',
        })
        resetForm(); setFormOpen(false); announceSuccess('تم حفظ السحب كحركة صندوق مرتبطة بالموظف')
      } catch (error) {
        alert(error?.message || 'تعذر حفظ حركة السحب. لم يتم إنشاء مصروف مكرر.')
      }
      return
    }
    const row = {
      id: makeId(), amount: numericAmount, category, date: createdAt, createdAt,
      employeeId: personId || '',
      shift: session?.name || 'وردية غير محددة', shiftId: session?.shiftId || session?.cashierId || '', cashierId: session?.cashierId || session?.shiftId || '', person,
      notes: cleanNotes, description: cleanDescription, status: 'disabled',
      operationalDayId, businessDate,
      entryType, source: 'manual',
      employeeId: staff.find(row => row.name === person)?.id || session?.cashierId || '',
      employeeNameSnapshot: person,
      paymentSource: entryType === 'current' && payFromCashbox ? 'cashbox' : 'other',
    }
    try {
      await (entryType === 'current' && payFromCashbox ? saveCentralExpenseWithCashbox(row) : saveCentralExpense(row))
      resetForm(); setFormOpen(false); announceSuccess('تم حفظ المصروف بنجاح')
    } catch (error) {
      if (['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) {
        saveLocalExpensePending(row)
        resetForm(); setFormOpen(false); announceSuccess('تم حفظ المصروف محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
      } else alert(error?.message || 'تعذر مزامنة المصروف.')
    }
  }
  const beginEdit = expense => { const matchedPerson = staff.find(row => String(row.id) === String(expense.employeeId || expense.staffId || expense.cashierId) || row.name === (expense.person || expense.employeeNameSnapshot || '')); setEditingId(expense.id); setAmount(String(expense.amount)); setCategory(expense.category || 'أخرى'); setPerson(matchedPerson?.name || expense.person || expense.employeeNameSnapshot || 'علي'); setPersonId(matchedPerson?.id || expense.employeeId || expense.staffId || expense.cashierId || ''); setDescription(expense.description || expense.notes || ''); setNotes(expense.notes && expense.notes !== expense.description ? expense.notes : ''); setEntryType(expense.entryType === 'historical' ? 'historical' : 'current'); setHistoricalDate(expense.businessDate || ''); setPayFromCashbox(expense.paymentSource === 'cashbox'); setFormOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const confirmDelete = async () => {
    if (!deleting) return
    try { await deleteCentralExpense(deleting); setDeleting(null) } catch (error) { alert(error?.message || 'تعذر مزامنة حذف المصروف.') }
  }
  const total = useMemo(() => expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0), [expenses])
  const allExpenseDiagnostic = useMemo(() => {
    const grouped = expenses.reduce((result, row) => {
      const key = row.businessDate || 'غير محدد'
      result[key] = (result[key] || 0) + Number(row.amount || 0)
      return result
    }, {})
    return { pending: expenses.filter(row => row.syncStatus === 'pending').length, grouped }
  }, [expenses])
  const displayedExpenses = useMemo(() => expenses
    .filter(row => (!dateFrom || row.businessDate >= dateFrom) && (!dateTo || row.businessDate <= dateTo))
    .slice()
    .sort((a, b) => String(b.businessDate || '').localeCompare(String(a.businessDate || '')) || Number(b.createdAt || b.date || 0) - Number(a.createdAt || a.date || 0)), [expenses, dateFrom, dateTo])
  const setQuickFilter = days => { const today = getLocalDateKey(Date.now()); const from = days === 0 ? today : getLocalDateKey(Date.now() - days * 86400000); setDateFrom(from); setDateTo(today) }
  const goBack = onNavigate || onBack
  const selectedPerson = person || staff.find(row => row.active)?.name || 'غير محدد'

  return (
    <div className="expenses-container" dir="rtl">
      <div className="expenses-header">
        <div><h2>المصاريف</h2><p>سجّل مصروف اليوم أو أضف مصروفًا سابقًا مع الحفاظ على تاريخ الأعمال.</p></div>
        <div className="expenses-header-actions">
          <button className="primary-action" type="button" onClick={runMasterRecovery} disabled={syncing || recovering || masterRecoveryBusy}>{masterRecoveryBusy ? 'جاري مزامنة واسترجاع المصاريف...' : 'مزامنة واسترجاع كل المصاريف'}</button>
          <button className="outline-btn" type="button" onClick={() => goBack?.('dashboard')}>العودة للرئيسية</button>
        </div>
      </div>
      {syncMessage && <div className="report-card" style={{ marginBottom: '1rem' }}><strong>{syncMessage}</strong></div>}
      {masterRecoveryStatus && <div className="report-card" style={{ marginBottom: '1rem' }} role="status"><strong>{masterRecoveryStatus}</strong></div>}
      {successMessage && <div className="expense-success" role="status" aria-live="polite">{successMessage}</div>}
      <section className={`expense-entry-card${formOpen ? ' is-open' : ''}`}>
        <button type="button" className="expense-entry-toggle" aria-expanded={formOpen} onClick={() => setFormOpen(open => !open)}>
          <span className="expense-entry-toggle-copy"><strong>{formOpen ? 'إضافة مصروف' : '+ إضافة مصروف جديد'}</strong><small>اضغط لإظهار تفاصيل التسجيل</small></span>
          <span className="expense-entry-summary"><span>{entryType === 'historical' ? 'مصروف سابق' : 'مصروف اليوم الحالي'}</span><span>{selectedPerson}</span></span>
          <span className="expense-entry-chevron" aria-hidden="true">{formOpen ? '⌃' : '⌄'}</span>
        </button>
        {formOpen && <form onSubmit={submit} className="expense-form"><div className="expense-form-grid">
        <fieldset className="expense-mode-field"><legend>نوع التسجيل</legend><div className="expense-mode-toggle"><label><input type="radio" name="entryType" value="current" checked={entryType === 'current'} onChange={() => setEntryType('current')} /> مصروف اليوم الحالي</label><label><input type="radio" name="entryType" value="historical" checked={entryType === 'historical'} onChange={() => setEntryType('historical')} /> مصروف سابق</label></div></fieldset>
        <label>المبلغ (د.ع)<input autoFocus inputMode="decimal" dir="ltr" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label>الوصف<input type="text" value={description} onChange={e => setDescription(e.target.value)} required placeholder="مثال: شراء حليب أو مواد تنظيف" /></label>
        <label>نوع المصروف<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>الموظف / الكاشير<select value={personId || person} onChange={e => { const value = e.target.value; const selected = staff.find(row => String(row.id) === value); setPersonId(selected?.id || ''); setPerson(selected?.name || value) }}>{(staff.length ? staff.filter(row => row.active !== false).map(row => <option key={row.id} value={row.id}>{row.name}{row.code ? ` · ${row.code}` : ''}</option>) : people.map(value => <option key={value} value={value}>{value}</option>))}</select></label>
        {entryType === 'current' ? <div className="expense-date-context"><span>تاريخ الأعمال</span><strong>{effectiveOperationalDay?.status === 'open' ? effectiveOperationalDay.businessDate : 'لا يوجد يوم مفتوح'}</strong><small>يرتبط المصروف باليوم التشغيلي المفتوح، حتى بعد منتصف الليل.</small></div> : <label>التاريخ السابق<input type="date" max={getLocalDateKey(Date.now())} value={historicalDate} onChange={e => setHistoricalDate(e.target.value)} required /></label>}
        <label className="expense-notes">ملاحظات (اختياري)<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="أضف ملاحظة عند الحاجة" rows="3" /></label>
        {entryType === 'current' && category !== 'سحوبات' ? <label className="expense-cashbox-toggle"><input type="checkbox" checked={payFromCashbox} onChange={e => setPayFromCashbox(e.target.checked)} /> الدفع من الصندوق</label> : category === 'سحوبات' ? <div className="expense-safe-note">سيُحفظ كسحب صندوق canonical مرتبط بالموظف، ولن يُنشأ له مصروف مكرر.</div> : <div className="expense-safe-note">المصروف السابق يُحفظ بتاريخه ولا يغيّر رصيد صندوق اليوم الحالي.</div>}
      </div><div className="expense-form-actions"><button className="primary-action" type="submit" disabled={!editingId && (entryType === 'current' ? !(effectiveOperationalDay?.status === 'open' && effectiveOperationalDay?.id && effectiveOperationalDay?.businessDate) : !historicalDate)}>{editingId ? 'حفظ التعديل' : 'حفظ المصروف'}</button>{editingId && <button className="outline-btn" type="button" onClick={resetForm}>إلغاء التعديل</button>}</div></form>}
      </section>
      <div className="report-card expense-total"><h3>إجمالي المصاريف: {format(total)}</h3></div>
      <section className="report-card expense-diagnostic" aria-label="كل المصاريف"><h3>كل المصاريف</h3><p>المصدر المركزي للتقارير هو Firebase RTDB؛ المحلي وPending يُدمجان محافظًا ولا يستبدلان المركزي.</p><div className="recovery-stats"><span>Firebase: <b>{centralCount === null ? 'غير متاح' : centralCount}</b> سجل</span><span>Local: <b>{localCount}</b></span><span>Pending: <b>{allExpenseDiagnostic.pending}</b></span><span>Merged: <b>{expenses.length}</b></span><span>الإجمالي: <b>{format(total)}</b></span></div><div className="diagnostic-groups">{Object.entries(allExpenseDiagnostic.grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, amount]) => <span key={date}>{date}: <b>{format(amount)}</b></span>)}</div>{centralCount !== null && !centralExpenses.some(expense => expense.businessDate === '2026-09-27') && <small>لا يوجد سجل مركزي بتاريخ 2026-09-27؛ السجل موجود محليًا على جهاز آخر أو غير موجود في Firebase.</small>}</section>
      <section className="expense-list-card"><div className="expense-list-heading"><div><h3>قائمة المصاريف</h3><p>الأحدث أولًا — الفلتر يؤثر على العرض فقط.</p></div><div className="expense-date-filters"><label>من تاريخ<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label>إلى تاريخ<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label><div className="quick-filters"><button type="button" onClick={() => setQuickFilter(0)}>اليوم</button><button type="button" onClick={() => setQuickFilter(1)}>أمس</button><button type="button" onClick={() => setQuickFilter(7)}>آخر 7 أيام</button><button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}>الكل</button></div></div></div><div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>الموظف</th><th>الحالة / المصدر</th><th>إجراءات</th></tr></thead><tbody>
        {displayedExpenses.length === 0 ? <tr><td colSpan="6" className="empty-cell">لا توجد مصاريف ضمن الفترة المختارة</td></tr> : displayedExpenses.map(expense => <tr key={expense.id}><td><b>{expense.businessDate || '—'}</b><br/><small>{formatDateTime(expense.createdAt ?? expense.date)}</small></td><td><strong>{expense.description || expense.notes || '—'}</strong>{expense.notes && expense.notes !== expense.description && <small className="expense-row-note">{expense.notes}</small>}</td><td className="expense-amount">{format(expense.amount)}</td><td>{expense.person || expense.employeeNameSnapshot || '—'}</td><td><span className={`sync-state ${expense.syncStatus === 'pending' ? 'pending' : ''}`}>{expense.syncStatus === 'pending' ? 'Pending Sync' : 'محفوظ مركزيًا'}</span><small className="expense-entry-type">{expense.entryType === 'historical' ? 'مصروف سابق' : 'مصروف حالي'}</small></td><td className="expense-actions"><button type="button" className="edit-expense" onClick={() => beginEdit(expense)}>تعديل</button><button type="button" className="delete-expense" onClick={() => setDeleting(expense)}>حذف</button></td></tr>)}
      </tbody></table></div>
      </section>
      {deleting && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog expense-delete-dialog"><h2>تأكيد حذف المصروف</h2><p>سيتم حذف هذا السجل فقط:</p><dl><div><dt>المبلغ</dt><dd>{format(deleting.amount)}</dd></div><div><dt>النوع</dt><dd>{deleting.category}</dd></div><div><dt>الوصف</dt><dd>{deleting.notes || '—'}</dd></div><div><dt>التاريخ</dt><dd>{formatDateTime(deleting.date)}</dd></div></dl><div className="dialog-actions"><button className="secondary-action" onClick={() => setDeleting(null)}>إلغاء</button><button className="delete-expense" onClick={confirmDelete}>تأكيد الحذف</button></div></div></div>}
      {masterRecoveryResult && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog master-recovery-dialog" dir="rtl"><h2>اكتملت مزامنة المصاريف</h2><p>{masterRecoveryResult.message}</p><dl><div><dt>Local قبل</dt><dd>{masterRecoveryResult.localBefore}</dd></div><div><dt>المرشحون</dt><dd>{masterRecoveryResult.candidatesFound}</dd></div><div><dt>Unique</dt><dd>{masterRecoveryResult.uniqueCandidates}</dd></div><div><dt>Duplicates</dt><dd>{masterRecoveryResult.duplicateCandidates}</dd></div><div><dt>Invalid</dt><dd>{masterRecoveryResult.invalidCandidates}</dd></div><div><dt>Firebase قبل</dt><dd>{masterRecoveryResult.firebaseBefore}</dd></div><div><dt>المرفوع بعد read-back</dt><dd>{masterRecoveryResult.uploaded}</dd></div><div><dt>Pending محفوظ</dt><dd>{masterRecoveryResult.pendingRetained}</dd></div><div><dt>Firebase بعد</dt><dd>{masterRecoveryResult.firebaseAfter}</dd></div><div><dt>الدمج النهائي</dt><dd>{masterRecoveryResult.finalMergedCount}</dd></div><div><dt>الإجمالي</dt><dd>{format(masterRecoveryResult.totalAmount)}</dd></div><div><dt>أيام businessDate</dt><dd>{masterRecoveryResult.businessDateCount}</dd></div></dl><section className="recovery-diagnostics"><h3>السجلات المحلية حسب التاريخ</h3>{Object.entries(masterRecoveryResult.dateDiagnostics || {}).map(([date, row]) => <div key={`local-${date}`}>{date}: {row.local}</div>)}<h3>Firebase حسب التاريخ</h3>{Object.entries(masterRecoveryResult.dateDiagnostics || {}).map(([date, row]) => <div key={`firebase-${date}`}>{date}: قبل {row.firebaseBefore} · رفع {row.uploaded} · بعد {row.firebaseAfter}</div>)}<h3>تحقق التقرير 2026-09-27</h3><div>Local 2026-09-27 = {masterRecoveryResult.dateDiagnostics?.['2026-09-27']?.local || 0} · Firebase before 2026-09-27 = {masterRecoveryResult.dateDiagnostics?.['2026-09-27']?.firebaseBefore || 0} · Uploaded 2026-09-27 = {masterRecoveryResult.dateDiagnostics?.['2026-09-27']?.uploaded || 0} · Firebase after 2026-09-27 = {masterRecoveryResult.dateDiagnostics?.['2026-09-27']?.firebaseAfter || 0} · التقرير: {masterRecoveryResult.reportVerification?.pass ? 'PASS' : 'FAIL'}</div><h3>تشخيص المرشحين</h3>{(masterRecoveryResult.candidateDiagnostics || []).map(row => <div key={`${row.id}-${row.recoverySource}`}><strong>{row.id}</strong> · {row.businessDate || 'بدون تاريخ'} · {format(row.amount)} · {row.source || row.recoverySource} · {row.candidateStatus} / {row.decision}: {row.reason}</div>)}</section><div className="dialog-actions"><button className="primary-action" type="button" onClick={() => setMasterRecoveryResult(null)}>إغلاق</button></div></div></div>}
    </div>
  )
}
