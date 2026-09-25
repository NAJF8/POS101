import { useMemo, useState } from 'react'
import { Icon } from './Icons'

const PAGE_SIZE = 10
const readSales = () => {
  try { return JSON.parse(localStorage.getItem('pos101.sales')) || [] } catch { return [] }
}
import { formatMoney, formatDateTime, formatNumber } from '../utils.js'
const money = formatMoney
const paymentLabel = value => value === 'cash' ? 'نقدي' : value === 'electronic' || value === 'card' ? 'إلكتروني' : 'غير محدد'
const statusLabel = value => value === 'voided' ? 'مبطل' : 'مكتمل'
const typeLabel = sale => sale.order?.orderType || sale.orderType || 'داخل الكوفي'
const localDate = formatDateTime

function SaleDetails({ sale, onBack, onPrint, onVoid }) {
  const [confirmingVoid, setConfirmingVoid] = useState(false)
  const items = sale.items || sale.order?.items || []

  return (
    <section className="history-details" aria-label="تفاصيل المبيعات">
      <div className="history-details-head">
        <button className="history-back" onClick={onBack}><Icon name="arrow" size={18} /> العودة للسجل</button>
        <div>
          <span className={`history-status ${sale.status === 'voided' ? 'voided' : 'complete'}`}>{statusLabel(sale.status)}</span>
          <h3>تفاصيل الطلب #{sale.orderNumber ? formatNumber(sale.orderNumber) : '—'}</h3>
          <p>{localDate(sale.createdAt)} · {paymentLabel(sale.paymentMethod)}</p>
        </div>
      </div>

      <div className="sale-meta-grid">
        <div><span>نوع الطلب</span><b>{typeLabel(sale)}</b></div>
        <div><span>الكاشير</span><b>{sale.cashierNameSnapshot || 'غير مسجل'}</b></div>
        <div><span>المجموع الفرعي</span><b>{money(sale.subtotal)}</b></div>
        <div><span>الخصم</span><b>{money(sale.discount)}</b></div>
      </div>

      <div className="sale-items-table-wrap">
        <table className="sale-items-table">
          <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
          <tbody>{items.map((item, index) => (
            <tr key={item.lineId || `${item.id}-${index}`}>
              <td><b>{item.name}</b>{item.options?.length ? <small>{item.options.join('، ')}</small> : null}{item.notes ? <small>ملاحظة: {item.notes}</small> : null}</td>
              <td className="number-cell">{formatNumber(item.quantity)}</td>
              <td className="number-cell">{money(item.price)}</td>
              <td className="number-cell">{money(item.price * item.quantity)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="history-details-total"><span>الإجمالي المسجل</span><b>{money(sale.total)}</b></div>
      {sale.voidedAt && <p className="void-audit">أُبطل محليًا في {localDate(sale.voidedAt)}. بقيت بيانات البيع الأصلية محفوظة في السجل.</p>}

      <div className="history-details-actions">
        <button onClick={() => onPrint(sale)}><Icon name="printer" size={18} /> إعادة طباعة</button>
        <button disabled title="التعديل المالي غير متاح حتى يُربط هذا النموذج بسجل تصحيح مصرح به"><Icon name="edit" size={18} /> تعديل غير متاح</button>
        {sale.status !== 'voided' && (
          confirmingVoid ? (
            <span className="void-confirm"><b>تأكيد الإبطال؟</b><button onClick={() => onVoid(sale)}>تأكيد</button><button onClick={() => setConfirmingVoid(false)}>رجوع</button></span>
          ) : <button className="history-void" onClick={() => setConfirmingVoid(true)}><Icon name="trash" size={18} /> إبطال البيع</button>
        )}
      </div>
    </section>
  )
}

export default function OrderHistoryMenu({ onClose, session }) {
  const [sales, setSales] = useState(readSales)
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [method, setMethod] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedSale, setSelectedSale] = useState(null)

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLocaleLowerCase()
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null
    return sales.filter(sale => {
      const textMatches = !lowerQuery || String(sale.orderNumber || '').includes(lowerQuery) || (sale.items || sale.order?.items || []).some(item => `${item.name || ''} ${item.english || ''}`.toLocaleLowerCase().includes(lowerQuery))
      const dateMatches = (!from || sale.createdAt >= from) && (!to || sale.createdAt <= to)
      const methodMatches = method === 'all' || sale.paymentMethod === method || (method === 'electronic' && sale.paymentMethod === 'card')
      const statusMatches = status === 'all' || (status === 'completed' && sale.status !== 'voided') || sale.status === status
      return textMatches && dateMatches && methodMatches && statusMatches
    }).toSorted((a, b) => b.createdAt - a.createdAt)
  }, [sales, query, fromDate, toDate, method, status])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const resetPage = action => { action(); setPage(1) }

  const reprint = sale => window.dispatchEvent(new CustomEvent('print-historical-sale', { detail: sale }))
  const voidSale = sale => {
    const voidedAt = Date.now()
    const audit = { id: crypto.randomUUID(), type: 'void', at: voidedAt, cashierId: session?.cashierId || null, cashierNameSnapshot: session?.cashierNameSnapshot || null }
    const nextSales = sales.map(entry => entry.id === sale.id ? { ...entry, status: 'voided', voidedAt, audit: [...(entry.audit || []), audit] } : entry)
    localStorage.setItem('pos101.sales', JSON.stringify(nextSales))
    setSales(nextSales)
    setSelectedSale(nextSales.find(entry => entry.id === sale.id))
  }

  return (
    <div className="history-modal-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="history-modal-content" role="dialog" aria-modal="true" aria-labelledby="history-title">
        {selectedSale ? <SaleDetails sale={selectedSale} onBack={() => setSelectedSale(null)} onPrint={reprint} onVoid={voidSale} /> : <>
          <header className="history-header"><div><h2 id="history-title"><Icon name="receipt" size={24} /> سجل الطلبات</h2><p>عرض جميع الطلبات السابقة</p></div><button className="close-btn" onClick={onClose} aria-label="إغلاق سجل الطلبات"><Icon name="x" size={23} /></button></header>
          <div className="history-filters">
            <label className="history-search"><Icon name="search" size={20} /><input type="search" placeholder="ابحث برقم الطلب أو المنتج…" value={query} onChange={event => resetPage(() => setQuery(event.target.value))} /></label>
            <label><span>من</span><input type="date" value={fromDate} max={toDate || undefined} onChange={event => resetPage(() => setFromDate(event.target.value))} /></label>
            <label><span>إلى</span><input type="date" value={toDate} min={fromDate || undefined} onChange={event => resetPage(() => setToDate(event.target.value))} /></label>
            <select aria-label="وسيلة الدفع" value={method} onChange={event => resetPage(() => setMethod(event.target.value))}><option value="all">جميع الوسائل</option><option value="cash">نقدي</option><option value="electronic">إلكتروني</option></select>
            <select aria-label="حالة الطلب" value={status} onChange={event => resetPage(() => setStatus(event.target.value))}><option value="all">جميع الحالات</option><option value="completed">مكتمل</option><option value="voided">مبطل</option></select>
          </div>
          <div className="history-table-wrapper"><table className="history-table"><thead><tr><th>#</th><th>رقم الطلب</th><th>النوع</th><th>التاريخ والوقت</th><th>الوسيلة</th><th>المبلغ</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{paginated.map((sale, index) => <tr key={sale.id} className={sale.status === 'voided' ? 'history-row-voided' : ''}><td className="number-cell">{formatNumber((safePage - 1) * PAGE_SIZE + index + 1)}</td><td className="number-cell">{formatNumber(sale.orderNumber)}</td><td>{typeLabel(sale)}</td><td className="date-cell">{localDate(sale.createdAt)}</td><td>{paymentLabel(sale.paymentMethod)}</td><td className="number-cell money-cell">{money(sale.total)}</td><td><span className={`history-status ${sale.status === 'voided' ? 'voided' : 'complete'}`}>{statusLabel(sale.status)}</span></td><td><div className="h-actions"><button onClick={() => setSelectedSale(sale)} title="عرض التفاصيل" aria-label={`عرض تفاصيل الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="search" size={17} /></button><button onClick={() => reprint(sale)} title="إعادة طباعة" aria-label={`إعادة طباعة الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="printer" size={17} /></button><button disabled title="التعديل المالي غير متاح حتى يُربط بسجل تصحيح مصرح به" aria-label="تعديل غير متاح"><Icon name="edit" size={17} /></button>{sale.status !== 'voided' && <button className="history-void" onClick={() => setSelectedSale(sale)} title="فتح تفاصيل الإبطال" aria-label={`إبطال الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="trash" size={17} /></button>}</div></td></tr>)}{!paginated.length && <tr><td className="history-empty" colSpan="8"><Icon name="receipt" size={28} /><b>{sales.length ? 'لا توجد مبيعات تطابق عوامل التصفية' : 'لا توجد مبيعات مسجلة بعد'}</b></td></tr>}</tbody></table></div>
          <footer className="history-footer"><div className="history-count">إجمالي النتائج: <b>{formatNumber(filtered.length)}</b></div><nav className="pagination" aria-label="ترقيم صفحات السجل"><button disabled={safePage === 1} onClick={() => setPage(value => value - 1)}>السابق</button><span>صفحة {formatNumber(safePage)} من {formatNumber(totalPages)}</span><button disabled={safePage === totalPages} onClick={() => setPage(value => value + 1)}>التالي</button></nav></footer>
        </>}
      </section>
    </div>
  )
}
