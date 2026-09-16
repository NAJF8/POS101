import React, { useState } from 'react'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }

export function Expenses({ onNavigate }) {
  const [expenses, setExpenses] = useState(() => read('pos101.expenses', []))
  
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <div className="expenses-container" dir="rtl" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>المصاريف</h2>
        <button className="primary-action" onClick={() => onNavigate('dashboard')}>العودة للرئيسية</button>
      </div>
      
      <div className="report-card" style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '8px' }}>
        <h3>إجمالي المصاريف: {format(total)}</h3>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'right' }}>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>التاريخ</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>نوع المصروف</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>المبلغ</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>الوردية</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>الموظف</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {expenses.length === 0 ? (
            <tr><td colSpan="6" style={{ padding: '10px', textAlign: 'center' }}>لا توجد مصاريف مسجلة</td></tr>
          ) : expenses.map(e => (
            <tr key={e.id}>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{new Date(e.date).toLocaleString('ar-IQ')}</td>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{e.category}</td>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{format(e.amount)}</td>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{e.shift}</td>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{e.person}</td>
              <td style={{ padding: '10px', border: '1px solid #ddd' }}>{e.notes || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ExpenseEntry({ onNavigate }) {
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('مشتريات')
  const [date, setDate] = useState(() => new Date().toISOString().substring(0, 16))
  const [person, setPerson] = useState('علي')
  const [notes, setNotes] = useState('')
  
  const [session] = useState(() => read('pos101.session', {}))

  const submit = e => {
    e.preventDefault()
    if (!amount || amount <= 0) return alert('يرجى إدخال مبلغ صحيح')
    
    const expense = {
      id: crypto.randomUUID(),
      amount: Number(amount),
      category,
      date: new Date(date).getTime(),
      shift: session.shiftName || 'غير محدد',
      person,
      notes
    }
    
    const expenses = read('pos101.expenses', [])
    localStorage.setItem('pos101.expenses', JSON.stringify([...expenses, expense]))
    alert('تم حفظ المصروف بنجاح')
    onNavigate('dashboard')
  }

  return (
    <div className="expense-entry-container" dir="rtl" style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>إضافة مصروف جديد</h2>
        <button className="outline-btn" onClick={() => onNavigate('dashboard')}>إلغاء</button>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--surface-color)', padding: '2rem', borderRadius: '8px' }}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            المبلغ (د.ع)
            <input autoFocus type="number" value={amount} onChange={e => setAmount(e.target.value)} required style={{ padding: '8px', marginTop: '4px' }} />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            نوع المصروف
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '8px', marginTop: '4px' }}>
              <option value="مشتريات">مشتريات</option>
              <option value="صيانة">صيانة</option>
              <option value="نقل">نقل</option>
              <option value="أدوات تنظيف">أدوات تنظيف</option>
              <option value="أخرى">أخرى</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            التاريخ والوقت
            <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required style={{ padding: '8px', marginTop: '4px' }} />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            الموظف
            <select value={person} onChange={e => setPerson(e.target.value)} style={{ padding: '8px', marginTop: '4px' }}>
              <option value="علي">علي</option>
              <option value="روان">روان</option>
              <option value="محمد">محمد</option>
              <option value="ميس">ميس</option>
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column' }}>
          ملاحظات
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: شراء مواد تنظيف" style={{ padding: '8px', marginTop: '4px' }} />
        </label>

        <button className="primary-action" type="submit" style={{ marginTop: '1rem' }}>حفظ المصروف</button>
      </form>
    </div>
  )
}
