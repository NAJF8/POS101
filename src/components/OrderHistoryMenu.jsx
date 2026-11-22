import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'
import { readSalesCache, writeSalesCache } from '../services/localSalesCache.js'

const PAGE_SIZE = 10
const readSales = () => readSalesCache()
import { formatMoney, formatDateTime, formatTime, formatNumber } from '../utils.js'
import { businessDateForSale } from '../services/reportSales.js'
import { anyStaffCanEditCompletedOrders, authorizeCompletedOrderEdit, completedOrderEditCandidates } from '../services/saleEdit.js'
import { getOptionLabel, normalizeCartItems, safeNumber, safeText } from '../services/cartItem.js'
const money = formatMoney
const paymentLabel = value => value === 'cash' ? 'نقدي' : value === 'electronic' || value === 'card' ? 'إلكتروني' : 'غير محدد'
const statusLabel = value => value === 'voided' ? 'مبطل' : value === 'void_pending_sync' ? 'إبطال غير مثبت مركزيًا' : 'مكتمل'
const typeLabel = sale => sale.order?.orderType || sale.orderType || 'داخل الكوفي'
const localDate = formatDateTime
const businessDateLabel = sale => {
  const value = businessDateForSale(sale)
  const [, year, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  return year ? `${day}/${month}/${year}` : '—'
}

const firstArray = values => values.find(value => Array.isArray(value) && value.length) || []
const soldItemsForEdit = sale => firstArray([
  sale?.items, sale?.cart, sale?.products, sale?.orderItems, sale?.lines,
  sale?.order?.items, sale?.order?.cart, sale?.order?.products, sale?.order?.orderItems, sale?.order?.lines,
])
const normalizeSoldItem = (item, index) => {
  const quantityValue = safeNumber(item?.quantity ?? item?.qty ?? item?.count, 0)
  const unitPriceValue = safeNumber(item?.price ?? item?.unitPrice ?? item?.unit_price ?? item?.amount, 0)
  const storedLineTotal = item?.lineTotal ?? item?.line_total ?? item?.total
  const lineTotalValue = storedLineTotal === undefined ? unitPriceValue * quantityValue : safeNumber(storedLineTotal, 0)
  const options = Array.isArray(item?.options) ? item.options.map(getOptionLabel).filter(Boolean).join('، ') : getOptionLabel(item?.options)
  const notes = safeText(item?.notes ?? item?.note)
  return {
    key: item?.lineId || item?.id || `sold-item-${index}`,
    _originalIndex: index,
    name: getOptionLabel(item?.displayName ?? item?.name ?? item?.productName ?? item?.title ?? item?.itemName ?? item?.product?.name) || 'منتج غير مسمى',
    quantity: quantityValue,
    unitPrice: unitPriceValue,
    lineTotal: lineTotalValue,
    options,
    notes: String(notes || ''),
  }
}

function SoldProductsSnapshot({ sale }) {
  const items = soldItemsForEdit(sale).map(normalizeSoldItem)
  return <section className="history-edit-products" aria-labelledby="history-edit-products-title">
    <h4 id="history-edit-products-title">المنتجات المباعة</h4>
    {items.length ? <div className="history-edit-items-table-wrap"><table className="history-edit-items-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>{items.map(item => <tr key={item.key}><td><b>{item.name}</b>{item.options && <small>الخيارات: {item.options}</small>}{item.notes && <small>ملاحظة: {item.notes}</small>}</td><td className="number-cell">{formatNumber(item.quantity)}</td><td className="number-cell">{money(item.unitPrice)}</td><td className="number-cell">{money(item.lineTotal)}</td></tr>)}</tbody></table></div> : <p className="history-edit-empty-items">لا توجد تفاصيل منتجات محفوظة لهذا الطلب</p>}
    <dl className="history-edit-order-summary"><div><dt>المجموع قبل الخصم</dt><dd>{money(sale?.subtotal)}</dd></div><div><dt>الخصم</dt><dd>{money(sale?.discount)}</dd></div><div><dt>الإجمالي بعد الخصم</dt><dd>{money(sale?.total)}</dd></div><div><dt>وسيلة الدفع</dt><dd>{paymentLabel(sale?.paymentMethod)}</dd></div><div><dt>نوع الطلب / المصدر</dt><dd>{typeLabel(sale)}</dd></div></dl>
  </section>
}

function EditableSoldProducts({ items, enabled, canCorrect, onChange, onDelete, oldTotal, newTotal, paymentMethod, orderType }) {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0)
  return <section className="history-edit-products" aria-labelledby="history-edit-products-title">
    <div className="history-edit-products-heading"><h4 id="history-edit-products-title">المنتجات المباعة</h4><button type="button" className="history-edit-correction-toggle" onClick={enabled.toggle}>{enabled.value ? 'إيقاف تصحيح المنتجات' : 'تفعيل تصحيح المنتجات'}</button></div>
    {enabled.value && <p className="history-edit-warning" role="note">هذا التصحيح يؤثر على إجمالي الطلب والتقارير وسيتم تسجيله في سجل التدقيق</p>}
    {items.length ? <div className="history-edit-items-table-wrap"><table className="history-edit-items-table history-edit-items-editable"><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th><th aria-label="إجراء" /></tr></thead><tbody>{items.map(item => { const lineTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0); return <tr key={item.key}><td><b>{item.name}</b>{item.options && <small>الخيارات: {item.options}</small>}{item.notes && <small>ملاحظة: {item.notes}</small>}</td><td className="number-cell"><input aria-label={`كمية ${item.name}`} dir="ltr" type="number" min="0.001" step="any" value={item.quantity} disabled={!enabled.value} onChange={event => onChange(item._originalIndex, 'quantity', event.target.value)} /></td><td className="number-cell"><input aria-label={`سعر ${item.name}`} dir="ltr" type="number" min="0" step="any" value={item.unitPrice} disabled={!enabled.value} onChange={event => onChange(item._originalIndex, 'unitPrice', event.target.value)} /></td><td className="number-cell">{money(lineTotal)}</td><td>{enabled.value && <button type="button" className="history-edit-delete-item" onClick={() => onDelete(item._originalIndex)} aria-label={`حذف ${item.name}`}>حذف</button>}</td></tr> })}</tbody></table></div> : <p className="history-edit-empty-items">لا توجد تفاصيل منتجات محفوظة لهذا الطلب</p>}
    <dl className="history-edit-order-summary"><div><dt>المجموع قبل الخصم</dt><dd>{money(subtotal)}</dd></div><div><dt>الخصم</dt><dd>يُطبق أدناه</dd></div><div><dt>الإجمالي السابق</dt><dd>{money(oldTotal)}</dd></div><div><dt>الإجمالي الجديد</dt><dd>{money(newTotal)}</dd></div><div><dt>الفرق</dt><dd>{money(newTotal - oldTotal)}</dd></div><div><dt>وسيلة الدفع</dt><dd>{paymentLabel(paymentMethod)}</dd></div><div><dt>نوع الطلب / المصدر</dt><dd>{orderType || 'داخل الكوفي'}</dd></div></dl>
  </section>
}

function SaleDetails({ sale, onBack, onPrint, onVoid, onEdit, editDisabledTitle = 'التعديل متاح فقط لليوم المفتوح', readOnly = false }) {
  const [confirmingVoid, setConfirmingVoid] = useState(false)
  const items = normalizeCartItems(sale.items || sale.order?.items)

  return (
    <section className="history-details" aria-label="تفاصيل المبيعات">
      <div className="history-details-head">
        <button className="history-back" onClick={onBack}><Icon name="arrow" size={18} /> العودة للسجل</button>
        <div>
          <span className={`history-status ${sale.status === 'voided' ? 'voided' : 'complete'}`}>{statusLabel(sale.status)}</span>
          <h3>تفاصيل الطلب #{sale.orderNumber ? formatNumber(sale.orderNumber) : '—'}</h3>
          <p title={`وقت البيع الفعلي: ${localDate(sale.createdAt)}`}>تاريخ العمل: {businessDateLabel(sale)} · وقت البيع: {formatTime(sale.createdAt, { hour: '2-digit', minute: '2-digit', hour12: false })} · {paymentLabel(sale.paymentMethod)}</p>
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
              <td><b>{item.displayName}</b>{item.options?.length ? <small>{item.options.map(getOptionLabel).filter(Boolean).join('، ')}</small> : null}{item.notes ? <small>ملاحظة: {item.notes}</small> : null}</td>
              <td className="number-cell">{formatNumber(item.quantity)}</td>
              <td className="number-cell">{money(item.price)}</td>
              <td className="number-cell">{money(item.price * item.quantity)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="history-details-total"><span>الإجمالي المسجل</span><b>{money(sale.total)}</b></div>
      {sale.voidedAt && <p className="void-audit">أُبطل محليًا في {localDate(sale.voidedAt)}. بقيت بيانات البيع الأصلية محفوظة في السجل.</p>}

      {!readOnly && <div className="history-details-actions">
        <button onClick={() => onPrint(sale)}><Icon name="printer" size={18} /> إعادة طباعة</button>
        <button disabled={!onEdit || sale.status === 'voided'} onClick={() => onEdit?.(sale)} title={onEdit ? 'تعديل آمن مع سجل تدقيق' : editDisabledTitle}><Icon name="edit" size={18} /> تعديل</button>
        {sale.status !== 'voided' && (
          confirmingVoid ? (
            <span className="void-confirm"><b>تأكيد الإبطال؟</b><button onClick={async () => { await onVoid(sale); setConfirmingVoid(false) }}>تأكيد</button><button onClick={() => setConfirmingVoid(false)}>رجوع</button></span>
          ) : <button className="history-void" onClick={() => setConfirmingVoid(true)}><Icon name="trash" size={18} /> إبطال البيع</button>
        )}
      </div>}
    </section>
  )
}

export default function OrderHistoryMenu({ onClose, session, salesOverride = null, onEditSale = null, onVoidSale = null, canCorrectSaleItems = false, staff = [], correctionActor = null, correctionAuthorization = null, readOnly = false }) {
  const [sales, setSales] = useState(() => salesOverride ?? readSales())
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [method, setMethod] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedSale, setSelectedSale] = useState(null)
  const [editingSale, setEditingSale] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [correctionMode, setCorrectionMode] = useState(false)
  const [correctionItems, setCorrectionItems] = useState([])
  const [authSale, setAuthSale] = useState(null)
  const [authForm, setAuthForm] = useState({ staffId: '', pin: '' })
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [editorName, setEditorName] = useState('')
  const editAuthorizationRef = useRef(null)
  const [editSuccess, setEditSuccess] = useState('')
  const editCandidates = useMemo(() => completedOrderEditCandidates(staff), [staff])
  const editPermissionAvailable = useMemo(() => anyStaffCanEditCompletedOrders(staff), [staff])
  const editDisabledTitle = !onEditSale ? 'التعديل متاح فقط لليوم المفتوح' : 'لا يوجد موظف لديه صلاحية تعديل الطلب بعد البيع'

  useEffect(() => {
    if (!editingSale) return undefined
    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.classList.add('history-edit-open')
    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
      body.classList.remove('history-edit-open')
    }
  }, [editingSale])

  useEffect(() => {
    const refresh = () => setSales(salesOverride ?? readSales())
    window.addEventListener('pos101-sales-updated', refresh)
    window.addEventListener('pos101-sale-created', refresh)
    return () => {
      window.removeEventListener('pos101-sales-updated', refresh)
      window.removeEventListener('pos101-sale-created', refresh)
    }
  }, [salesOverride])

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLocaleLowerCase()
    return sales.filter(sale => {
      const textMatches = !lowerQuery || String(sale.orderNumber || '').includes(lowerQuery) || (sale.items || sale.order?.items || []).some(item => `${item.name || ''} ${item.english || ''}`.toLocaleLowerCase().includes(lowerQuery))
      const saleBusinessDate = businessDateForSale(sale)
      const dateMatches = (!fromDate || saleBusinessDate >= fromDate) && (!toDate || saleBusinessDate <= toDate)
      const methodMatches = method === 'all' || sale.paymentMethod === method || (method === 'electronic' && sale.paymentMethod === 'card')
      const statusMatches = status === 'all' || (status === 'completed' && !['voided', 'void_pending_sync'].includes(sale.status)) || sale.status === status
      return textMatches && dateMatches && methodMatches && statusMatches
    }).toSorted((a, b) => b.createdAt - a.createdAt)
  }, [sales, query, fromDate, toDate, method, status])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const resetPage = action => { action(); setPage(1) }

  const reprint = sale => window.dispatchEvent(new CustomEvent('print-historical-sale', { detail: sale }))
  const voidSale = async sale => {
    if (onVoidSale) {
      const saved = await onVoidSale(sale)
      const nextSales = sales.map(entry => (entry.saleId || entry.id) === (saved.saleId || saved.id) ? saved : entry)
      setSales(nextSales)
      setSelectedSale(saved)
      return saved
    }
    const voidedAt = Date.now()
    const audit = { id: crypto.randomUUID(), type: 'void', at: voidedAt, cashierId: session?.cashierId || null, cashierNameSnapshot: session?.cashierNameSnapshot || null }
    const nextSales = sales.map(entry => entry.id === sale.id ? { ...entry, status: 'voided', voidedAt, audit: [...(entry.audit || []), audit] } : entry)
    writeSalesCache(nextSales)
    window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: nextSales.find(entry => entry.id === sale.id) }))
    setSales(nextSales)
    setSelectedSale(nextSales.find(entry => entry.id === sale.id))
  }
  // Step 1-3: choose employee (by staff id), enter the existing POS PIN, then
  // check EDIT_COMPLETED_ORDER. The service layer re-checks both on save.
  const beginEdit = sale => {
    setEditError('')
    setEditSuccess('')
    setAuthError('')
    setAuthForm({ staffId: editCandidates[0]?.id || '', pin: '' })
    setAuthSale(sale)
  }
  const closeAuthorization = () => { if (authBusy) return; setAuthSale(null); setAuthForm({ staffId: '', pin: '' }); setAuthError('') }
  const confirmEditAuthorization = async event => {
    event.preventDefault()
    if (authBusy || !authSale) return
    setAuthBusy(true); setAuthError('')
    try {
      const result = await authorizeCompletedOrderEdit({ staffId: authForm.staffId, pin: authForm.pin, staff })
      if (!result.ok) { setAuthError(result.message); setAuthForm(form => ({ ...form, pin: '' })); return }
      editAuthorizationRef.current = { staffId: result.staffId, pin: authForm.pin }
      setEditorName(result.name)
      const sale = authSale
      setAuthSale(null); setAuthForm({ staffId: '', pin: '' })
      openEditor(sale)
    } catch (error) {
      setAuthError(error?.message || 'تعذر التحقق من الموظف.')
    } finally { setAuthBusy(false) }
  }
  const closeEditor = () => {
    editAuthorizationRef.current = null
    setEditorName(''); setEditingSale(null); setEditForm(null); setCorrectionMode(false)
  }
  const openEditor = sale => {
    setEditError('')
    setEditingSale(sale)
    setCorrectionMode(false)
    setCorrectionItems(soldItemsForEdit(sale).map(normalizeSoldItem))
    const discount = sale.discount === '' || !Number.isFinite(Number(sale.discount)) ? 0 : sale.discount
    setEditForm({ note: sale.customerNote ?? sale.orderNote ?? sale.cashierNote ?? sale.note ?? sale.notes ?? '', orderType: sale.orderType || sale.order?.orderType || '', paymentMethod: sale.paymentMethod || 'cash', discount, cashier: sale.cashierNameSnapshot || sale.cashierName || sale.seller || '', adminNote: sale.adminNote || sale.editNote || '', reason: '' })
  }
  const updateCorrectionItem = (originalIndex, field, value) => setCorrectionItems(items => items.map(item => item._originalIndex === originalIndex ? { ...item, [field]: value } : item))
  const deleteCorrectionItem = originalIndex => {
    if (correctionItems.length <= 1) { setEditError('لا يمكن حذف جميع المنتجات من طلب مكتمل. استخدم إلغاء/تصحيح إداري منفصل.'); return }
    setCorrectionItems(items => items.filter(item => item._originalIndex !== originalIndex))
    setEditError('')
  }
  const saveEdit = async event => {
    event.preventDefault()
    if (!editingSale || !onEditSale || !editForm) return
    const editAuthorization = editAuthorizationRef.current
    if (!editAuthorization) { setEditError('يلزم التحقق من الموظف قبل حفظ التعديل.'); return }
    const reason = String(editForm.reason || '').trim()
    if (!reason) { setEditError('سبب التعديل مطلوب.'); return }
    setEditBusy(true); setEditError('')
    try {
      const changes = correctionMode
        ? { ...editForm, reason, itemCorrection: true, items: correctionItems, editAuthorization }
        : { ...editForm, reason, editAuthorization }
      const saved = await onEditSale(editingSale, changes)
      const nextSales = sales.map(entry => entry.id === saved.id ? saved : entry)
      const savedBy = editorName
      setSales(nextSales); setSelectedSale(saved); closeEditor()
      setEditSuccess(`تم حفظ التعديل باسم ${savedBy}`)
    } catch (error) {
      setEditError(error?.message || 'تعذر حفظ تعديل البيع.')
    } finally { setEditBusy(false) }
  }

  return (
      <div className="history-modal-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      {editSuccess && <p className="history-edit-success" role="status">{editSuccess}</p>}
      <section className="history-modal-content" role="dialog" aria-modal="true" aria-labelledby="history-title">
        {selectedSale ? <SaleDetails sale={selectedSale} onBack={() => setSelectedSale(null)} onPrint={reprint} onVoid={voidSale} onEdit={!readOnly && onEditSale && editPermissionAvailable ? beginEdit : null} editDisabledTitle={editDisabledTitle} readOnly={readOnly} /> : <>
            <header className="history-header"><div><h2 id="history-title"><Icon name="receipt" size={24} /> سجل الطلبات</h2><p>عرض جميع الطلبات السابقة حسب تاريخ العمل التشغيلي</p></div><button className="close-btn" onClick={onClose} aria-label="إغلاق سجل الطلبات"><Icon name="x" size={23} /></button></header>
          <div className="history-filters">
            <label className="history-search"><Icon name="search" size={20} /><input type="search" placeholder="ابحث برقم الطلب أو المنتج…" value={query} onChange={event => resetPage(() => setQuery(event.target.value))} /></label>
            <label><span>من</span><input type="date" value={fromDate} max={toDate || undefined} onChange={event => resetPage(() => setFromDate(event.target.value))} /></label>
            <label><span>إلى</span><input type="date" value={toDate} min={fromDate || undefined} onChange={event => resetPage(() => setToDate(event.target.value))} /></label>
            <select aria-label="وسيلة الدفع" value={method} onChange={event => resetPage(() => setMethod(event.target.value))}><option value="all">جميع الوسائل</option><option value="cash">نقدي</option><option value="electronic">إلكتروني</option></select>
            <select aria-label="حالة الطلب" value={status} onChange={event => resetPage(() => setStatus(event.target.value))}><option value="all">جميع الحالات</option><option value="completed">مكتمل</option><option value="voided">مبطل</option></select>
          </div>
          <div className="history-table-wrapper"><table className="history-table"><thead><tr><th>#</th><th>رقم الطلب</th><th>النوع</th><th>اليوم التشغيلي / الوقت</th><th>الوسيلة</th><th>المبلغ</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{paginated.map((sale, index) => <tr key={sale.id} className={sale.status === 'voided' ? 'history-row-voided' : ''}><td className="number-cell">{formatNumber((safePage - 1) * PAGE_SIZE + index + 1)}</td><td className="number-cell">{formatNumber(sale.orderNumber)}</td><td>{typeLabel(sale)}</td><td className="date-cell" title={`وقت البيع الفعلي: ${localDate(sale.createdAt)}`}><span className="history-business-date">{businessDateLabel(sale)}<small>{formatTime(sale.createdAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</small></span></td><td>{paymentLabel(sale.paymentMethod)}</td><td className="number-cell money-cell">{money(sale.total)}</td><td><span className={`history-status ${sale.status === 'voided' ? 'voided' : 'complete'}`}>{statusLabel(sale.status)}</span></td><td><div className="h-actions"><button onClick={() => setSelectedSale(sale)} title="عرض التفاصيل" aria-label={`عرض تفاصيل الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="search" size={17} /></button>{!readOnly && <><button onClick={() => reprint(sale)} title="إعادة طباعة" aria-label={`إعادة طباعة الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="printer" size={17} /></button><button disabled={!onEditSale || !editPermissionAvailable || sale.status === 'voided'} onClick={() => beginEdit(sale)} title={onEditSale && editPermissionAvailable ? 'تعديل آمن مع سجل تدقيق' : editDisabledTitle} aria-label="تعديل الطلب"><Icon name="edit" size={17} /></button>{sale.status !== 'voided' && <button className="history-void" onClick={() => setSelectedSale(sale)} title="فتح تفاصيل الإبطال" aria-label={`إبطال الطلب ${formatNumber(sale.orderNumber)}`}><Icon name="trash" size={17} /></button>}</>}</div></td></tr>)}{!paginated.length && <tr><td className="history-empty" colSpan="8"><Icon name="receipt" size={28} /><b>{sales.length ? 'لا توجد مبيعات تطابق عوامل التصفية' : 'لا توجد مبيعات مسجلة بعد'}</b></td></tr>}</tbody></table></div>
          <footer className="history-footer"><div className="history-count">إجمالي النتائج: <b>{formatNumber(filtered.length)}</b></div><nav className="pagination" aria-label="ترقيم صفحات السجل"><button disabled={safePage === 1} onClick={() => setPage(value => value - 1)}>السابق</button><span>صفحة {formatNumber(safePage)} من {formatNumber(totalPages)}</span><button disabled={safePage === totalPages} onClick={() => setPage(value => value + 1)}>التالي</button></nav></footer>
        </>}
      </section>
      {editingSale && editForm && createPortal(<div className="history-edit-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && !editBusy && closeEditor()}><form className="history-edit-modal" onSubmit={saveEdit} dir="rtl" role="dialog" aria-modal="true" aria-labelledby="history-edit-title"><header className="history-edit-header"><div><h3 id="history-edit-title">تعديل الطلب رقم {formatNumber(editingSale.orderNumber)}</h3><p>{correctionMode ? 'وضع تصحيح إداري للعناصر والأسعار.' : 'المنتجات ورقم الطلب واليوم التشغيلي محمية.'}{editorName ? ` · المعدِّل: ${editorName}` : ''}</p></div><button type="button" className="history-edit-close" onClick={closeEditor} disabled={editBusy} aria-label="إغلاق نافذة تعديل الطلب"><Icon name="x" size={22} /></button></header><div className="history-edit-body"><EditableSoldProducts items={correctionItems} canCorrect={canCorrectSaleItems} enabled={{ value: correctionMode, toggle: () => { setCorrectionMode(value => !value); setEditError('') } }} onChange={updateCorrectionItem} onDelete={deleteCorrectionItem} oldTotal={Number(editingSale.total) || 0} newTotal={correctionMode ? correctionItems.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0) - (Number(editForm.discount) || 0) : Number(editingSale.total) || 0} paymentMethod={editForm.paymentMethod} orderType={editForm.orderType} /><label><span>المصدر / النوع</span><select value={editForm.orderType} onChange={event => setEditForm({ ...editForm, orderType: event.target.value })}><option value="">داخل الكوفي</option><option value="بلي">بلي</option><option value="توترز">توترز</option><option value="سفري">سفري</option></select></label><label><span>وسيلة الدفع</span><select value={editForm.paymentMethod} onChange={event => setEditForm({ ...editForm, paymentMethod: event.target.value })}><option value="cash">نقدي</option><option value="electronic">إلكتروني</option></select></label><label className="history-edit-discount"><span>الخصم</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={editForm.discount ?? ''} onChange={event => setEditForm({ ...editForm, discount: event.target.value })} /></label><label><span>اسم الكاشير</span><input value={editForm.cashier} onChange={event => setEditForm({ ...editForm, cashier: event.target.value })} /></label><label><span>ملاحظة العميل</span><textarea className="history-edit-textarea-short" value={editForm.note} onChange={event => setEditForm({ ...editForm, note: event.target.value })} /></label><label><span>ملاحظة الإدارة</span><textarea className="history-edit-textarea-short" value={editForm.adminNote} onChange={event => setEditForm({ ...editForm, adminNote: event.target.value })} /></label><label><span>سبب التعديل (مطلوب)</span><input required value={editForm.reason} onChange={event => setEditForm({ ...editForm, reason: event.target.value })} /></label>{editError && <p className="form-error" role="alert">{editError}</p>}</div><footer className="history-edit-actions"><button type="button" onClick={closeEditor} disabled={editBusy}>إلغاء</button><button className="primary-action" type="submit" disabled={editBusy || !String(editForm.reason || '').trim()}>{editBusy ? 'جارٍ الحفظ…' : correctionMode ? 'حفظ التصحيح' : 'حفظ التعديل'}</button></footer></form></div>, document.body)}
      {authSale && createPortal(<div className="history-edit-overlay history-identity-overlay" role="presentation" onKeyDown={event => event.key === 'Escape' && closeAuthorization()}><form className="history-identity-modal" onSubmit={confirmEditAuthorization} dir="rtl" lang="ar" role="dialog" aria-modal="true" aria-labelledby="history-identity-title" aria-describedby="history-identity-desc" aria-busy={authBusy}><header className="history-edit-header"><div><h3 id="history-identity-title">تأكيد تعديل الطلب</h3><p id="history-identity-desc">تعديل الطلب رقم {formatNumber(authSale.orderNumber)} بعد البيع يتطلب رمز دخول موظف مخوّل.</p></div><button type="button" className="history-edit-close" onClick={closeAuthorization} disabled={authBusy} aria-label="إلغاء تأكيد تعديل الطلب"><Icon name="x" size={22} /></button></header><div className="history-identity-body"><label><span>اسم الموظف</span><select value={authForm.staffId} onChange={event => { setAuthForm({ staffId: event.target.value, pin: '' }); setAuthError('') }} disabled={authBusy || !editCandidates.length} required>{editCandidates.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>رمز الدخول</span><input autoFocus required type="password" inputMode="numeric" autoComplete="off" dir="ltr" value={authForm.pin} onChange={event => { setAuthForm({ ...authForm, pin: event.target.value.replace(/\D/g, '').slice(0, 8) }); setAuthError('') }} disabled={authBusy || !editCandidates.length} /></label>{!editCandidates.length && <p className="form-error" role="alert">لا يوجد موظف برمز دخول مفعّل.</p>}{authError && <p className="form-error" role="alert">{authError}</p>}</div><footer className="history-edit-actions"><button type="button" onClick={closeAuthorization} disabled={authBusy}>إلغاء</button><button className="primary-action" type="submit" disabled={authBusy || !authForm.staffId || !authForm.pin}>{authBusy ? 'جارٍ التحقق…' : 'تأكيد'}</button></footer></form></div>, document.body)}
    </div>
  )
}
