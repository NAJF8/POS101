import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatDateTime } from '../utils.js'
import { getLocalDateKey, normalizeDateKey } from '../services/expenseReporting.js'
import { deleteCentralExpense, findOperationalDayByBusinessDate, readLocalExpenses, readLocalOperationalDay, saveCentralExpense, saveCentralExpenseWithCashbox, saveCashboxTransaction, subscribeCentralExpenses } from '../services/posCentralSync.js'

const format = formatMoney
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
const categories = ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'راتب', 'سحوبات', 'أخرى']
const people = ['علي', 'روان', 'محمد', 'ميس']
const centralExpensesLabel = 'بيانات المصاريف المركزية'

export function Expenses({ onNavigate, onBack, session, operationalDay = null, staff = [] }) {
  const effectiveOperationalDay = operationalDay?.status === 'open' ? operationalDay : readLocalOperationalDay()
  const [expenses, setExpenses] = useState(() => readLocalExpenses())
  const [centralCount, setCentralCount] = useState(null)
  const [centralExpenses, setCentralExpenses] = useState([])
  const [localCount, setLocalCount] = useState(() => readLocalExpenses().length)
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
  const [fundingSource, setFundingSource] = useState('cashbox')
  const [withdrawalFundingSource, setWithdrawalFundingSource] = useState('cashbox')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [expenseListOpen, setExpenseListOpen] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const announceSuccess = message => {
    setSuccessMessage(message)
    window.setTimeout(() => setSuccessMessage(''), 3200)
  }

  const resetForm = () => { const activePerson = staff.find(row => row.active) || null; setEditingId(null); setAmount(''); setCategory('مشتريات'); setPerson(activePerson?.name || 'علي'); setPersonId(activePerson?.id || ''); setDescription(''); setNotes(''); setEntryType('current'); setHistoricalDate(''); setFundingSource('cashbox'); setWithdrawalFundingSource('cashbox') }
  const submit = async e => {
    e.preventDefault()
    const numericAmount = Number(amount)
    const cleanDescription = description.trim()
    const cleanNotes = notes.trim()
    const todayKey = getLocalDateKey(Date.now())
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !cleanDescription) { setSyncMessage('يرجى إدخال مبلغ ووصف صحيحين'); return }
    if (entryType === 'historical' && (!normalizeDateKey(historicalDate) || historicalDate > todayKey)) { setSyncMessage('اختر تاريخًا سابقًا صحيحًا، ولا يمكن اختيار تاريخ مستقبلي.'); return }
    if (editingId) {
      if (category === 'سحوبات') { setSyncMessage('السحب يُحفظ من خلال حركة الصندوق canonical؛ لم يتم إنشاء مصروف مكرر.'); return }
      const current = expenses.find(row => row.id === editingId)
      let edited = current ? { ...current, amount: numericAmount, category, person, employeeId: personId || current.employeeId || '', employeeNameSnapshot: person, notes: cleanNotes, description: cleanDescription, entryType, fundingSource, paymentSource: fundingSource, updatedAt: Date.now() } : null
      if (edited && entryType === 'historical') {
        try {
          const match = await findOperationalDayByBusinessDate(historicalDate)
          edited = { ...edited, businessDate: historicalDate, operationalDayId: match.operationalDayId, entryType: 'historical', source: 'manual' }
          if (match.ambiguous) console.warn('HISTORICAL_OPERATIONAL_DAY_AMBIGUOUS', { businessDate: historicalDate, matchCount: match.matches.length })
        } catch (error) {
          if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) { setSyncMessage(error?.message || 'تعذر مطابقة اليوم التشغيلي التاريخي.'); return }
          edited = { ...edited, businessDate: historicalDate, operationalDayId: '', entryType: 'historical', source: 'manual' }
        }
      } else if (edited) edited = { ...edited, entryType: 'current', businessDate: current?.businessDate || effectiveOperationalDay?.businessDate || '', operationalDayId: current?.operationalDayId || effectiveOperationalDay?.id || '' }
      try {
        const saved = await saveCentralExpense(edited, { existing: true })
        setExpenses(currentRows => currentRows.map(row => row.id === saved.id ? saved : row))
        resetForm(); setFormOpen(false); announceSuccess('تم تعديل المصروف بنجاح')
      } catch (error) {
        if (error?.code === 'AUTH_REQUIRED' && edited) {
          const pending = saveLocalExpensePending(edited)
          setExpenses(currentRows => currentRows.map(row => row.id === pending.id ? pending : row))
          setSyncMessage('تم الاحتفاظ بالتعديل محليًا فقط — Pending Sync. لم يثبت الحفظ المركزي بعد.')
        } else setSyncMessage(error?.message || 'تعذر مزامنة تعديل المصروف.')
      }
      return
    }
    if (entryType === 'current' && (effectiveOperationalDay?.status !== 'open' || !effectiveOperationalDay?.id || !effectiveOperationalDay?.businessDate)) {
      setSyncMessage('يجب بدء يوم تشغيلي قبل تسجيل مصروف جديد حتى يُحسب المصروف ضمن نفس فترة العمل.')
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
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) { setSyncMessage(error?.message || 'تعذر مطابقة اليوم التشغيلي التاريخي.'); return }
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
          fundingSource: withdrawalFundingSource,
        })
        resetForm(); setFormOpen(false); announceSuccess('تم حفظ السحب كحركة صندوق مرتبطة بالموظف')
      } catch (error) {
        setSyncMessage(error?.message || 'تعذر حفظ حركة السحب. لم يتم إنشاء مصروف مكرر.')
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
      fundingSource,
      paymentSource: fundingSource,
    }
    try {
      await (fundingSource === 'cashbox' ? saveCentralExpenseWithCashbox(row) : saveCentralExpense(row))
      resetForm(); setFormOpen(false); announceSuccess('تم حفظ المصروف بنجاح')
    } catch (error) {
      if (['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) {
        saveLocalExpensePending(row)
        setSyncMessage('تم الاحتفاظ بالمصروف محليًا فقط — Pending Sync. لم يثبت الحفظ المركزي بعد.')
      } else setSyncMessage(error?.message || 'تعذر مزامنة المصروف.')
    }
  }
  const beginEdit = expense => { const matchedPerson = staff.find(row => String(row.id) === String(expense.employeeId || expense.staffId || expense.cashierId) || row.name === (expense.person || expense.employeeNameSnapshot || '')); setEditingId(expense.id); setAmount(String(expense.amount)); setCategory(expense.category || 'أخرى'); setPerson(matchedPerson?.name || expense.person || expense.employeeNameSnapshot || 'علي'); setPersonId(matchedPerson?.id || expense.employeeId || expense.staffId || expense.cashierId || ''); setDescription(expense.description || expense.notes || ''); setNotes(expense.notes && expense.notes !== expense.description ? expense.notes : ''); setEntryType(expense.entryType === 'historical' ? 'historical' : 'current'); setHistoricalDate(expense.businessDate || ''); setFundingSource(expense.fundingSource || expense.paymentSource || 'cashbox'); setFormOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const deleteExpense = async expense => {
    if (!expense || deleting) return
    setDeleting(expense.id)
    try {
      await deleteCentralExpense(expense)
      setExpenses(currentRows => currentRows.filter(row => row.id !== expense.id))
      setCentralExpenses(currentRows => currentRows.filter(row => row.id !== expense.id))
      announceSuccess('تم حذف المصروف والتحقق من اختفائه')
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر مزامنة حذف المصروف.')
    } finally { setDeleting(null) }
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
  useEffect(() => {
    const dirty = formOpen && Boolean(editingId || amount || description || notes || historicalDate)
    window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty } }))
    return () => window.dispatchEvent(new CustomEvent('pos101-form-dirty', { detail: { dirty: false } }))
  }, [formOpen, editingId, amount, description, notes, historicalDate])

  return (
    <div className="expenses-container" dir="rtl">
      <div className="expenses-header">
        <div><h2>المصاريف</h2><p>سجّل مصروف اليوم أو أضف مصروفًا سابقًا مع الحفاظ على تاريخ الأعمال.</p></div>
        <div className="expenses-header-actions">
          <button className="outline-btn" type="button" onClick={() => goBack?.('dashboard')}>العودة للرئيسية</button>
        </div>
      </div>
      {syncMessage && <div className="report-card" style={{ marginBottom: '1rem' }}><strong>{syncMessage}</strong></div>}
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
      {category !== 'سحوبات' ? <fieldset className="expense-cashbox-toggle"><legend>مصدر الدفع</legend><label><input type="radio" name="expenseFundingSource" value="cashbox" checked={fundingSource === 'cashbox'} onChange={() => setFundingSource('cashbox')} required /> من الصندوق</label><label><input type="radio" name="expenseFundingSource" value="management" checked={fundingSource === 'management'} onChange={() => setFundingSource('management')} /> من الإدارة</label><small>المصاريف من الإدارة تظهر في التقارير ولا تخصم من صندوق POS.</small></fieldset> : <><label>مصدر السحب<select value={withdrawalFundingSource} onChange={e => setWithdrawalFundingSource(e.target.value)}><option value="cashbox">من الصندوق</option><option value="management">من الإدارة</option></select></label><div className="expense-safe-note">سيُحفظ كسحب canonical مرتبط بالموظف؛ {withdrawalFundingSource === 'cashbox' ? 'يخصم من الصندوق.' : 'لا يخصم من الصندوق ولا من المتوقع النقدي.'}</div></>}
      </div><div className="expense-form-actions"><button className="primary-action" type="submit" disabled={!editingId && (entryType === 'current' ? !(effectiveOperationalDay?.status === 'open' && effectiveOperationalDay?.id && effectiveOperationalDay?.businessDate) : !historicalDate)}>{editingId ? 'حفظ التعديل' : 'حفظ المصروف'}</button>{editingId && <button className="outline-btn" type="button" onClick={resetForm}>إلغاء التعديل</button>}</div></form>}
      </section>
      <div className="report-card expense-total"><h3>إجمالي المصاريف: {format(total)}</h3><small>{centralExpensesLabel}</small></div>
      <section className="report-card expense-diagnostic" aria-label="كل المصاريف"><h3>كل المصاريف</h3><p>المصدر المركزي للتقارير هو Firebase RTDB؛ المحلي وPending يُدمجان محافظًا ولا يستبدلان المركزي.</p><div className="recovery-stats"><span>Firebase: <b>{centralCount === null ? 'غير متاح' : centralCount}</b> سجل</span><span>Local: <b>{localCount}</b></span><span>Pending: <b>{allExpenseDiagnostic.pending}</b></span><span>Merged: <b>{expenses.length}</b></span><span>الإجمالي: <b>{format(total)}</b></span></div><div className="diagnostic-groups">{Object.entries(allExpenseDiagnostic.grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, amount]) => <span key={date}>{date}: <b>{format(amount)}</b></span>)}</div>{centralCount !== null && !centralExpenses.some(expense => expense.businessDate === '2026-09-27') && <small>لا يوجد سجل مركزي بتاريخ 2026-09-27؛ السجل موجود محليًا على جهاز آخر أو غير موجود في Firebase.</small>}</section>
      <section className={`expense-list-card collapsible-card${expenseListOpen ? ' is-open' : ''}`}><div className="expense-list-heading collapsible-card-heading"><div><h3>قائمة المصاريف</h3><p>عدد السجلات: {expenses.length} · الإجمالي: {format(total)}</p></div><button type="button" className="collapsible-toggle" aria-expanded={expenseListOpen} aria-controls="expense-list-content" onClick={() => setExpenseListOpen(open => !open)}><span>{expenseListOpen ? 'إخفاء' : 'عرض'}</span><span className="collapsible-chevron" aria-hidden="true">{expenseListOpen ? '⌃' : '⌄'}</span></button></div>{expenseListOpen && <div id="expense-list-content"><div className="expense-date-filters"><label>من تاريخ<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label>إلى تاريخ<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label><div className="quick-filters"><button type="button" onClick={() => setQuickFilter(0)}>اليوم</button><button type="button" onClick={() => setQuickFilter(1)}>أمس</button><button type="button" onClick={() => setQuickFilter(7)}>آخر 7 أيام</button><button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}>الكل</button></div></div><div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>الموظف</th><th>الحالة / المصدر</th><th>إجراءات</th></tr></thead><tbody>
        {displayedExpenses.length === 0 ? <tr><td colSpan="6" className="empty-cell">لا توجد مصاريف ضمن الفترة المختارة</td></tr> : displayedExpenses.map(expense => <tr key={expense.id}><td><b>{expense.businessDate || '—'}</b><br/><small>{formatDateTime(expense.createdAt ?? expense.date)}</small></td><td><strong>{expense.description || expense.notes || '—'}</strong>{expense.notes && expense.notes !== expense.description && <small className="expense-row-note">{expense.notes}</small>}</td><td className="expense-amount">{format(expense.amount)}</td><td>{expense.person || expense.employeeNameSnapshot || '—'}</td><td><span className={`sync-state ${expense.syncStatus === 'pending' ? 'pending' : ''}`}>{expense.syncStatus === 'pending' ? 'Pending Sync' : 'محفوظ مركزيًا'}</span><small className="expense-entry-type">{expense.entryType === 'historical' ? 'مصروف سابق' : 'مصروف حالي'}</small></td><td className="expense-actions"><button type="button" className="edit-expense" onClick={() => beginEdit(expense)}>تعديل</button><button type="button" className="delete-expense" disabled={deleting === expense.id} onClick={() => deleteExpense(expense)}>{deleting === expense.id ? 'جارٍ الحذف…' : 'حذف'}</button></td></tr>)}
      </tbody></table></div></div>}
      </section>
    </div>
  )
}
