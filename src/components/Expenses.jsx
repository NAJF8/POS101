import React, { useMemo, useState } from 'react'
import { saveAccExpense } from '../services/accSync'

const STORAGE_KEY = 'pos101.expenses'
const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
const normalize = rows => rows.map(row => row?.id ? row : { ...row, id: makeId() })
const categories = ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'أخرى']
const people = ['علي', 'روان', 'محمد', 'ميس']

export function Expenses({ onNavigate, onBack, session }) {
  const [expenses, setExpenses] = useState(() => {
    const original = read(STORAGE_KEY, [])
    const rows = normalize(original)
    if (rows.some((row, index) => row.id !== original[index]?.id)) localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
    return rows
  })
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('مشتريات')
  const [person, setPerson] = useState('علي')
  const [notes, setNotes] = useState('')

  const resetForm = () => { setEditingId(null); setAmount(''); setCategory('مشتريات'); setPerson('علي'); setNotes('') }
  const saveRows = rows => { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); setExpenses(rows) }
  const submit = async e => {
    e.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !notes.trim()) return alert('يرجى إدخال مبلغ ووصف صحيحين')
    if (editingId) {
      saveRows(expenses.map(row => row.id === editingId ? { ...row, amount: numericAmount, category, person, notes: notes.trim() } : row))
      resetForm(); alert('تم تعديل المصروف بنجاح'); return
    }
    const row = { id: makeId(), amount: numericAmount, category, date: Date.now(), shift: session?.name || 'وردية غير محددة', shiftId: session?.accShiftId || '', person, notes: notes.trim() }
    try { await saveAccExpense(row, session?.profile) } catch (error) { alert(error?.message || 'تعذر حفظ المصروف في ACC-101'); return }
    saveRows([...expenses, row])
    resetForm(); alert('تم حفظ المصروف بنجاح')
  }
  const beginEdit = expense => { setEditingId(expense.id); setAmount(String(expense.amount)); setCategory(expense.category || 'أخرى'); setPerson(expense.person || 'علي'); setNotes(expense.notes || ''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const confirmDelete = () => { if (!deleting) return; saveRows(expenses.filter(row => row.id !== deleting.id)); setDeleting(null) }
  const total = useMemo(() => expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0), [expenses])
  const goBack = onNavigate || onBack

  return (
    <div className="expenses-container" dir="rtl">
      <div className="expenses-header"><h2>المصاريف</h2><button className="primary-action" onClick={() => goBack?.('dashboard')}>العودة للرئيسية</button></div>
      <form onSubmit={submit} className="expense-form"><div className="expense-form-grid">
        <label>المبلغ (د.ع)<input autoFocus type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label>نوع المصروف<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="expense-notes">صرفته على شنو؟ (الوصف)<input type="text" value={notes} onChange={e => setNotes(e.target.value)} required placeholder="مثال: شراء حليب أو مواد تنظيف..." /></label>
        <label>الموظف<select value={person} onChange={e => setPerson(e.target.value)}>{people.map(value => <option key={value}>{value}</option>)}</select></label>
      </div><div className="expense-form-actions"><button className="primary-action" type="submit">{editingId ? 'حفظ التعديل' : 'حفظ المصروف'}</button>{editingId && <button className="outline-btn" type="button" onClick={resetForm}>إلغاء التعديل</button>}</div></form>
      <div className="report-card expense-total"><h3>إجمالي المصاريف: {format(total)}</h3></div>
      <div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الوردية</th><th>الموظف</th><th>الوصف</th><th>إجراءات</th></tr></thead><tbody>
        {expenses.length === 0 ? <tr><td colSpan="7" className="empty-cell">لا توجد مصاريف مسجلة</td></tr> : expenses.slice().reverse().map(expense => <tr key={expense.id}><td>{new Date(expense.date).toLocaleString('ar-IQ')}</td><td>{expense.category}</td><td className="expense-amount">{format(expense.amount)}</td><td>{expense.shift || '—'}</td><td>{expense.person || '—'}</td><td>{expense.notes || '—'}</td><td className="expense-actions"><button type="button" className="edit-expense" onClick={() => beginEdit(expense)}>تعديل</button><button type="button" className="delete-expense" onClick={() => setDeleting(expense)}>حذف</button></td></tr>)}
      </tbody></table></div>
      {deleting && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog expense-delete-dialog"><h2>تأكيد حذف المصروف</h2><p>سيتم حذف هذا السجل فقط:</p><dl><div><dt>المبلغ</dt><dd>{format(deleting.amount)}</dd></div><div><dt>النوع</dt><dd>{deleting.category}</dd></div><div><dt>الوصف</dt><dd>{deleting.notes || '—'}</dd></div><div><dt>التاريخ</dt><dd>{new Date(deleting.date).toLocaleString('ar-IQ')}</dd></div></dl><div className="dialog-actions"><button className="secondary-action" onClick={() => setDeleting(null)}>إلغاء</button><button className="delete-expense" onClick={confirmDelete}>تأكيد الحذف</button></div></div></div>}
    </div>
  )
}
