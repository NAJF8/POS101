import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatDateTime } from '../utils.js'
import { deleteCentralExpense, readLocalExpenses, runExpenseCentralSync, saveCentralExpense, saveLocalExpensePending, signInCentralWithGoogle, subscribeCentralExpenses } from '../services/posCentralSync.js'

const format = formatMoney
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
const categories = ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'أخرى']
const people = ['علي', 'روان', 'محمد', 'ميس']

export function Expenses({ onNavigate, onBack, session, operationalDay = null }) {
  const [expenses, setExpenses] = useState(() => readLocalExpenses())
  useEffect(() => {
    const refresh = () => setExpenses(readLocalExpenses())
    window.addEventListener('pos101-expenses-updated', refresh)
    const stop = subscribeCentralExpenses(refresh)
    return () => { window.removeEventListener('pos101-expenses-updated', refresh); stop?.() }
  }, [])
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('مشتريات')
  const [person, setPerson] = useState('علي')
  const [notes, setNotes] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  const resetForm = () => { setEditingId(null); setAmount(''); setCategory('مشتريات'); setPerson('علي'); setNotes('') }
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
        await signInCentralWithGoogle()
        result = await runExpenseCentralSync({ initial: true })
      }
      setSyncMessage(`تمت المزامنة: رفع ${result?.uploaded || 0}، تخطي ${result?.skipped || 0}، الإجمالي المركزي ${result?.centralCount || 0}`)
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر تنفيذ المزامنة.')
    } finally {
      setSyncing(false)
    }
  }
  const submit = async e => {
    e.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !notes.trim()) return alert('يرجى إدخال مبلغ ووصف صحيحين')
    if (editingId) {
      const current = expenses.find(row => row.id === editingId)
      const edited = current ? { ...current, amount: numericAmount, category, person, notes: notes.trim(), description: notes.trim() } : null
      try {
        await saveCentralExpense(edited, { existing: true })
        resetForm(); alert('تم تعديل المصروف بنجاح')
      } catch (error) {
        if (error?.code === 'AUTH_REQUIRED' && edited) {
          saveLocalExpensePending(edited)
          resetForm()
          alert('تم حفظ التعديل محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
        } else alert(error?.message || 'تعذر مزامنة تعديل المصروف.')
      }
      return
    }
    if (operationalDay?.status !== 'open' || !operationalDay?.id || !operationalDay?.businessDate) {
      alert('يجب بدء يوم تشغيلي قبل تسجيل مصروف جديد حتى يُحسب المصروف ضمن نفس فترة العمل.')
      return
    }
    const createdAt = Date.now()
    const row = {
      id: makeId(), amount: numericAmount, category, date: createdAt, createdAt,
      shift: session?.name || 'وردية غير محددة', shiftId: session?.shiftId || session?.cashierId || '', cashierId: session?.cashierId || session?.shiftId || '', person,
      notes: notes.trim(), description: notes.trim(), status: 'disabled',
      operationalDayId: operationalDay.id,
      businessDate: operationalDay.businessDate,
    }
    try {
      await saveCentralExpense(row)
      resetForm()
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') {
        saveLocalExpensePending(row)
        resetForm()
        alert('تم حفظ المصروف محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
      } else alert(error?.message || 'تعذر مزامنة المصروف.')
    }
  }
  const beginEdit = expense => { setEditingId(expense.id); setAmount(String(expense.amount)); setCategory(expense.category || 'أخرى'); setPerson(expense.person || 'علي'); setNotes(expense.notes || ''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const confirmDelete = async () => {
    if (!deleting) return
    try { await deleteCentralExpense(deleting); setDeleting(null) } catch (error) { alert(error?.message || 'تعذر مزامنة حذف المصروف.') }
  }
  const total = useMemo(() => expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0), [expenses])
  const goBack = onNavigate || onBack

  return (
    <div className="expenses-container" dir="rtl">
      <div className="expenses-header">
        <h2>المصاريف</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="outline-btn" type="button" onClick={syncNow} disabled={syncing}>{syncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</button>
          <button className="primary-action" onClick={() => goBack?.('dashboard')}>العودة للرئيسية</button>
        </div>
      </div>
      {syncMessage && <div className="report-card" style={{ marginBottom: '1rem' }}><strong>{syncMessage}</strong></div>}
      <div className="report-card" style={{ marginBottom: '1rem' }}>
        <strong>اليوم التشغيلي للمصروف: {operationalDay?.status === 'open' && operationalDay?.businessDate ? operationalDay.businessDate : 'لا يوجد يوم مفتوح'}</strong>
        <div style={{ marginTop: '0.35rem' }}>
          <small>{operationalDay?.status === 'open' ? 'أي مصروف جديد يُربط بهذا اليوم حتى لو تجاوز الوقت منتصف الليل.' : 'ابدأ اليوم التشغيلي قبل تسجيل مصروف جديد.'}</small>
        </div>
      </div>
      <form onSubmit={submit} className="expense-form"><div className="expense-form-grid">
        <label>المبلغ (د.ع)<input autoFocus type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label>نوع المصروف<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="expense-notes">صرفته على شنو؟ (الوصف)<input type="text" value={notes} onChange={e => setNotes(e.target.value)} required placeholder="مثال: شراء حليب أو مواد تنظيف..." /></label>
        <label>الموظف<select value={person} onChange={e => setPerson(e.target.value)}>{people.map(value => <option key={value}>{value}</option>)}</select></label>
      </div><div className="expense-form-actions"><button className="primary-action" type="submit" disabled={!editingId && operationalDay?.status !== 'open'}>{editingId ? 'حفظ التعديل' : 'حفظ المصروف'}</button>{editingId && <button className="outline-btn" type="button" onClick={resetForm}>إلغاء التعديل</button>}</div></form>
      <div className="report-card expense-total"><h3>إجمالي المصاريف: {format(total)}</h3></div>
      <div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الوردية</th><th>الموظف</th><th>الوصف</th><th>إجراءات</th></tr></thead><tbody>
        {expenses.length === 0 ? <tr><td colSpan="7" className="empty-cell">لا توجد مصاريف مسجلة</td></tr> : expenses.slice().reverse().map(expense => <tr key={expense.id}><td><b>{expense.businessDate || '—'}</b><br/><small>{formatDateTime(expense.createdAt ?? expense.date)}</small></td><td>{expense.category}</td><td className="expense-amount">{format(expense.amount)}</td><td>{expense.shift || '—'}</td><td>{expense.person || '—'}</td><td>{expense.notes || '—'}</td><td className="expense-actions"><span className={`sync-state ${expense.syncStatus === 'pending' ? 'pending' : ''}`}>{expense.syncStatus === 'pending' ? 'Pending Sync' : 'Firebase مباشر'}</span><button type="button" className="edit-expense" onClick={() => beginEdit(expense)}>تعديل</button><button type="button" className="delete-expense" onClick={() => setDeleting(expense)}>حذف</button></td></tr>)}
      </tbody></table></div>
      {deleting && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog expense-delete-dialog"><h2>تأكيد حذف المصروف</h2><p>سيتم حذف هذا السجل فقط:</p><dl><div><dt>المبلغ</dt><dd>{format(deleting.amount)}</dd></div><div><dt>النوع</dt><dd>{deleting.category}</dd></div><div><dt>الوصف</dt><dd>{deleting.notes || '—'}</dd></div><div><dt>التاريخ</dt><dd>{formatDateTime(deleting.date)}</dd></div></dl><div className="dialog-actions"><button className="secondary-action" onClick={() => setDeleting(null)}>إلغاء</button><button className="delete-expense" onClick={confirmDelete}>تأكيد الحذف</button></div></div></div>}
    </div>
  )
}
