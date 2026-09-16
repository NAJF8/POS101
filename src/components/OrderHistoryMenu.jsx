import React, { useState, useMemo } from 'react'
import { Icon } from './Icons'

export default function OrderHistoryMenu({ onClose }) {
  const [sales, setSales] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pos101.sales')) || [] }
    catch { return [] }
  })
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('الكل')
  const [status, setStatus] = useState('الكل')
  const [page, setPage] = useState(1)
  const itemsPerPage = 10

  const filtered = useMemo(() => {
    return sales.filter(s => {
      const q = query.toLowerCase()
      const matchesQuery = !q || s.orderNumber?.toString().includes(q) || s.items?.some(i => i.name?.toLowerCase().includes(q) || i.english?.toLowerCase().includes(q))
      const matchesMethod = method === 'الكل' || (method === 'نقدي' && s.paymentMethod === 'cash') || (method === 'إلكتروني' && s.paymentMethod === 'card')
      const matchesStatus = status === 'الكل' || (status === 'ملغى' && s.status === 'voided') || (status === 'مكتمل' && s.status !== 'voided')
      return matchesQuery && matchesMethod && matchesStatus
    }).sort((a, b) => b.createdAt - a.createdAt)
  }, [sales, query, method, status])

  const paginated = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage)
  const totalPages = Math.ceil(filtered.length / itemsPerPage)

  const printSale = (sale) => {
    window.dispatchEvent(new CustomEvent('print-historical-sale', { detail: sale }))
  }

  const deleteSale = (sale) => {
    if (window.confirm('هل أنت متأكد من إلغاء/إبطال هذا الطلب؟')) {
      const newSales = sales.map(s => s.id === sale.id ? { ...s, status: 'voided' } : s)
      localStorage.setItem('pos101.sales', JSON.stringify(newSales))
      setSales(newSales)
    }
  }

  const viewSale = (sale) => {
    window.dispatchEvent(new CustomEvent('view-historical-sale', { detail: sale }))
  }

  return (
    <div className="history-modal-overlay">
      <div className="history-modal-content">
        <button className="close-btn" onClick={onClose}><Icon name="x" size={24} /></button>
        <div className="history-header">
          <h2><Icon name="receipt" size={24} /> سجل الطلبات</h2>
          <p>عرض جميع الطلبات السابقة</p>
        </div>

        <div className="history-filters">
          <div className="search-box">
            <Icon name="search" size={20} />
            <input type="text" placeholder="ابحث برقم الطلب أو المنتج..." value={query} onChange={e => {setQuery(e.target.value); setPage(1)}} />
          </div>
          <select value={method} onChange={e => {setMethod(e.target.value); setPage(1)}}>
            <option value="الكل">جميع الوسائل</option>
            <option value="نقدي">نقدي</option>
            <option value="إلكتروني">إلكتروني</option>
          </select>
          <select value={status} onChange={e => {setStatus(e.target.value); setPage(1)}}>
            <option value="الكل">جميع الحالات</option>
            <option value="مكتمل">مكتمل</option>
            <option value="ملغى">ملغى</option>
          </select>
        </div>

        <div className="history-table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>#</th>
                <th>رقم الطلب</th>
                <th>النوع</th>
                <th>التاريخ والوقت</th>
                <th>الوسيلة</th>
                <th>المبلغ</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((s, i) => (
                <tr key={s.id} style={{ opacity: s.status === 'voided' ? 0.5 : 1 }}>
                  <td>{(page - 1) * itemsPerPage + i + 1}</td>
                  <td>{s.orderNumber || '-'}</td>
                  <td>{s.order?.orderType || 'داخل'}</td>
                  <td>{new Date(s.createdAt).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{s.paymentMethod === 'cash' ? 'نقدي' : 'إلكتروني'}</td>
                  <td>{s.total?.toLocaleString()} د.ع {s.status === 'voided' && <span style={{color: 'red', fontSize: '10px'}}>(ملغى)</span>}</td>
                  <td className="h-actions">
                    <button onClick={() => viewSale(s)} title="عرض"><Icon name="search" size={16} /></button>
                    <button onClick={() => printSale(s)} title="طباعة"><Icon name="printer" size={16} /></button>
                    <button className="del" onClick={() => deleteSale(s)} title="إلغاء"><Icon name="trash" size={16} /></button>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '20px' }}>لا توجد طلبات مطابقة</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="history-footer">
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>«</button>
            <span>{page} / {totalPages || 1}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>»</button>
          </div>
          <div className="history-count">إجمالي الطلبات: {filtered.length}</div>
        </div>
      </div>
    </div>
  )
}
