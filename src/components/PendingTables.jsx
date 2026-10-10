import { useMemo, useState } from 'react'
import { formatNumber } from '../utils.js'
import { normalizeCartItems, safeNumber } from '../services/cartItem.js'

const statusLabel = { open: 'معلقة', paid: 'مدفوعة', cancelled: 'ملغية', unpaid_lost: 'غير مدفوعة / دين' }
const money = value => `${formatNumber(Number(value || 0))} د.ع`
const dateTime = value => value ? new Date(value).toLocaleString('ar-IQ') : '—'

export default function PendingTables({ tables = [], session, onClose, onPay, onEdit, onTransition }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState(null)
  const [action, setAction] = useState(null)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [error, setError] = useState('')
  const [editItems, setEditItems] = useState([])
  const rows = useMemo(() => tables.filter(row => (status === 'all' || row.status === status) && (!query.trim() || `${row.customerName || ''} ${row.phone || ''} ${row.tableNumber || ''}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => Number(b.openedAt || 0) - Number(a.openedAt || 0)), [tables, status, query])
  const openEdit = row => { setSelected(row); setEditItems(normalizeCartItems(row.items)); setAction('edit'); setError('') }
  const submit = async () => {
    if (!selected || busy) return
    setBusy(true); setError('')
    try {
      if (action === 'pay') await onPay(selected, { paymentMethod, sellerName: session?.name || session?.shiftName || '' })
      else if (action === 'edit') await onEdit(selected, { items: editItems, auditReason: 'تعديل طاولة معلقة' })
      else await onTransition(selected, { status: action, reason, confirmationName: confirmation })
      setAction(null); setSelected(null); setReason(''); setConfirmation('')
    } catch (e) { setError(e?.message || 'تعذر إكمال العملية.') } finally { setBusy(false) }
  }
  return <section className="pending-tables-page" dir="rtl">
    <div className="page-heading"><div><h1>{reportOpen ? 'تقرير الطاولات المعلقة' : 'الطاولات المعلقة'}</h1><p>الطاولات غير المدفوعة مستقلة عن المبيعات والتسوية.</p></div><div className="dialog-actions"><button className="outline-btn" type="button" onClick={() => setReportOpen(value => !value)}>{reportOpen ? 'الطاولات الحالية' : 'تقرير الطاولات المعلقة'}</button><button className="outline-btn" type="button" onClick={onClose}>العودة للرئيسية</button></div></div>
    {reportOpen && <section className="pending-report-summary"><h2>ملخص حسب الحالة</h2><div className="pending-report-cards">{Object.entries(statusLabel).map(([key, label]) => { const group = tables.filter(row => row.status === key); return <div key={key}><span>{label}</span><b>{group.length}</b><small>{money(group.reduce((sum, row) => sum + Number(row.total || 0), 0))}</small></div> })}</div><div className="financial-table-wrap"><table className="financial-table"><thead><tr><th>الزبون</th><th>الطاولة</th><th>فتح</th><th>دفع/إلغاء</th><th>الكاشير</th><th>الإجمالي</th><th>الحالة</th><th>linkedSaleId</th></tr></thead><tbody>{tables.map(row => <tr key={row.tabId || row.id}><td>{row.customerName}</td><td>{row.tableNumber || '—'}</td><td>{dateTime(row.openedAt)}</td><td>{dateTime(row.paidAt || row.cancelledAt || row.unpaid_lostAt)}</td><td>{row.cashierName || '—'}</td><td>{money(row.total)}</td><td>{statusLabel[row.status] || row.status}</td><td>{row.linkedSaleId || '—'}</td></tr>)}{!tables.length && <tr><td colSpan="8">لا توجد سجلات.</td></tr>}</tbody></table></div></section>}
    <div className="pending-toolbar"><input aria-label="البحث باسم الزبون" placeholder="بحث باسم الزبون أو الهاتف أو رقم الطاولة" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="تصفية الحالة" value={status} onChange={e => setStatus(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="pending-table-grid">{rows.map(row => <article className="pending-table-card" key={row.tabId || row.id}>
      <div className="pending-table-card-head"><h2>{row.customerName}</h2><span className={`pending-status pending-${row.status}`}>{statusLabel[row.status] || row.status}</span></div>
      <dl><div><dt>الطاولة</dt><dd>{row.tableNumber || '—'}</dd></div><div><dt>الهاتف</dt><dd>{row.phone || '—'}</dd></div><div><dt>فتح</dt><dd>{dateTime(row.openedAt)}</dd></div><div><dt>businessDate</dt><dd>{row.businessDate || '—'}</dd></div><div><dt>الكاشير</dt><dd>{row.cashierName || '—'}</dd></div><div><dt>الإجمالي</dt><dd>{money(row.total)}</dd></div></dl>
      <ul className="pending-item-list">{normalizeCartItems(row.items).map((item, index) => <li key={item.lineId || index}><span>{item.displayName}</span><span>{formatNumber(item.quantity)} × {money(item.price)}</span><b>{money(safeNumber(item.lineTotal, item.price * item.quantity))}</b></li>)}</ul>
      {row.note && <p className="pending-note">ملاحظة: {row.note}</p>}
      <div className="pending-actions"><button type="button" onClick={() => { setSelected(row); setAction('pay'); setError('') }} disabled={row.status !== 'open'}>تحصيل الدفع</button><button type="button" onClick={() => openEdit(row)} disabled={row.status !== 'open'}>تعديل</button><button type="button" onClick={() => { setSelected(row); setAction('cancelled'); setError('') }} disabled={row.status !== 'open'}>إلغاء</button><button type="button" onClick={() => { setSelected(row); setAction('unpaid_lost'); setError('') }} disabled={row.status !== 'open'}>تحويل إلى غير مدفوعة / دين</button></div>
    </article>)}{!rows.length && <p className="pending-empty">لا توجد طاولات مطابقة.</p>}</div>
    {selected && action && <div className="overlay"><div className="dialog pending-action-dialog">
      <h2>{action === 'pay' ? 'تحصيل الدفع' : action === 'edit' ? 'تعديل الطاولة المعلقة' : action === 'cancelled' ? 'إلغاء الطاولة' : 'تحويل إلى غير مدفوعة / دين'}</h2><p>الزبون: <b>{selected.customerName}</b> · الإجمالي: <b>{money(selected.total)}</b></p>
      {action === 'pay' && <label>طريقة الدفع<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="cash">نقدي</option><option value="electronic">إلكتروني</option></select></label>}
      {action === 'edit' && <div className="pending-edit-items">{editItems.map((item, index) => <div key={item.lineId || index}><span>{item.displayName}</span><label>الكمية<input type="number" min="0" value={item.quantity} onChange={e => setEditItems(v => v.map((x, i) => i === index ? { ...x, quantity: Number(e.target.value) } : x))} /></label><label>السعر<input type="number" min="0" value={item.price} onChange={e => setEditItems(v => v.map((x, i) => i === index ? { ...x, price: Number(e.target.value) } : x))} /></label></div>)}</div>}
      {action !== 'pay' && action !== 'edit' && <><label>السبب<textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} /></label><label>تأكيد اسم المستخدم/الكود<input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder={session?.name || session?.shiftName || ''} /></label></>}
      {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="secondary-action" type="button" onClick={() => setAction(null)}>إلغاء</button><button className="primary-action" type="button" disabled={busy || (action !== 'pay' && action !== 'edit' && (!reason.trim() || !confirmation.trim()))} onClick={submit}>{busy ? 'جارٍ الحفظ…' : 'تأكيد'}</button></div>
    </div></div>}
  </section>
}
