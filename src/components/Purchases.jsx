import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatDateTime } from '../utils.js'

const STORAGE_KEY = 'pos101.purchases'
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`
const numericPreview = (quantity, unitCost) => { const total = Number(quantity || 0) * Number(unitCost || 0); return Number.isFinite(total) ? total : 0 }

export function Purchases({ onNavigate, session, operationalDay = null }) {
  const catalogReady = false
  const [purchases, setPurchases] = useState(() => read(STORAGE_KEY, []))
  const inventory = []
  const suppliers = []
  const [item, setItem] = useState('')
  const [inventoryItemId, setInventoryItemId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [purchaseUnit, setPurchaseUnit] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const refresh = () => setPurchases(read(STORAGE_KEY, []))
    window.addEventListener('pos101-sync-updated', refresh)
    return () => window.removeEventListener('pos101-sync-updated', refresh)
  }, [])

  const selectedInventory = inventory.find(row => String(row.id) === String(inventoryItemId))
  const total = useMemo(() => purchases.reduce((sum, row) => sum + Number(row.total_after_discount ?? row.total ?? 0), 0), [purchases])
  const saveRows = rows => { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); setPurchases(rows) }
  const deletePurchase = id => {
    if (!window.confirm('هل تريد حذف عملية الشراء هذه؟')) return
    const nextPurchases = purchases.filter(row => String(row.id) !== String(id))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPurchases))
    setPurchases(nextPurchases)
  }
  const reset = () => { setItem(''); setInventoryItemId(''); setSupplierId(''); setQuantity('1'); setPurchaseUnit(''); setUnitCost(''); setSupplier(''); setPaymentMethod('cash'); setPaidAmount(''); setNotes('') }
  const submit = async e => {
    e.preventDefault()
    const numericQuantity = Number(quantity)
    const numericUnitCost = Number(unitCost)
    const numericTotal = numericQuantity * numericUnitCost
    const effectivePaid = paidAmount === '' ? numericTotal : Number(paidAmount)
    if ((!catalogReady && !item.trim()) || !Number.isFinite(numericQuantity) || numericQuantity <= 0 || !Number.isFinite(numericUnitCost) || numericUnitCost < 0 || !Number.isFinite(effectivePaid) || effectivePaid < 0 || effectivePaid > numericTotal) return alert('يرجى إدخال بيانات الشراء والدفع بشكل صحيح')
    if (catalogReady && (!selectedInventory || !supplierId)) return alert('عند استخدام كتالوج ACC يجب اختيار مادة مخزون ومورد موجودين في ACC-101')
    if (operationalDay?.status !== 'open' || !operationalDay?.id || !operationalDay?.businessDate) return alert('يجب بدء يوم تشغيلي قبل تسجيل عملية شراء جديدة حتى تُحسب ضمن نفس فترة العمل.')
    const createdAt = Date.now()
    const row = {
      id: makeId(), purchase_type: 'inventory', inventory_item_id: selectedInventory?.id || '', inventory_item_name: selectedInventory?.name_ar || selectedInventory?.name || item.trim(),
      quantity: numericQuantity, purchase_unit: purchaseUnit || selectedInventory?.base_unit || selectedInventory?.unit || 'piece', unit: purchaseUnit || selectedInventory?.base_unit || selectedInventory?.unit || 'piece',
      unit_cost: numericUnitCost, total: numericTotal, total_after_discount: numericTotal, supplier_id: supplierId || '', supplier_name: suppliers.find(value => String(value.id) === String(supplierId))?.name || supplier.trim(),
      paid_amount: effectivePaid, payment_method: paymentMethod, notes: notes.trim(),
      date: operationalDay.businessDate, businessDate: operationalDay.businessDate, operationalDayId: operationalDay.id, createdAt,
      shift: session?.name || 'وردية غير محددة', status: 'disabled', integration: 'disabled',
    }
    saveRows([...purchases, row])
    reset()
  }

  return <div className="expenses-container purchases-container" dir="rtl">
    <div className="expenses-header"><h2>المشتريات</h2><button className="primary-action" onClick={() => onNavigate?.('dashboard')}>العودة للرئيسية</button></div>
    <div className="report-card" style={{ marginBottom: '1rem' }}>
      <strong>اليوم التشغيلي للمشتريات: {operationalDay?.status === 'open' && operationalDay?.businessDate ? operationalDay.businessDate : 'لا يوجد يوم مفتوح'}</strong>
      <div style={{ marginTop: '0.35rem' }}><small>{operationalDay?.status === 'open' ? 'أي شراء جديد يُربط بهذا اليوم حتى يتم إنهاؤه.' : 'ابدأ اليوم التشغيلي قبل تسجيل شراء جديد.'}</small></div>
    </div>
    {catalogReady && <div className="notice wide">كتالوج ACC-101 متاح اختيارياً؛ تبقى المشتريات المحلية متاحة دائماً.</div>}
    <form onSubmit={submit} className="expense-form"><div className="expense-form-grid">
      {catalogReady ? <>
        <label>مادة المخزون<select value={inventoryItemId} onChange={e => { const next = inventory.find(value => String(value.id) === e.target.value); setInventoryItemId(e.target.value); setItem(next?.name_ar || next?.name || ''); setPurchaseUnit(next?.base_unit || next?.unit || ''); setUnitCost(String(next?.purchase_price ?? '')) }} required><option value="">اختر مادة من ACC-101</option>{inventory.map(value => <option key={value.id} value={value.id}>{value.name_ar || value.name}</option>)}</select></label>
        <label>المورد<select value={supplierId} onChange={e => setSupplierId(e.target.value)} required><option value="">اختر مورداً من ACC-101</option>{suppliers.map(value => <option key={value.id} value={value.id}>{value.name || value.name_ar}</option>)}</select></label>
      </> : <>
        <label>الصنف<input value={item} onChange={e => setItem(e.target.value)} required /></label>
        <label>المجهز<input value={supplier} onChange={e => setSupplier(e.target.value)} /></label>
      </>}
      <label>الكمية<input type="number" min="0.01" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
      <label>الوحدة<input value={purchaseUnit} onChange={e => setPurchaseUnit(e.target.value)} placeholder={selectedInventory?.base_unit || selectedInventory?.unit || 'piece'} /></label>
      <label>كلفة الوحدة (د.ع)<input type="number" min="0" step="1" value={unitCost} onChange={e => setUnitCost(e.target.value)} required /></label>
      <label>طريقة الدفع<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="cash">نقدي</option><option value="credit">آجل</option></select></label>
      <label>المدفوع<input type="number" min="0" step="1" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} placeholder={String(numericPreview(quantity, unitCost))} /></label>
      <label className="expense-notes">ملاحظات<input value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </div><div className="expense-form-actions"><button className="primary-action" type="submit" disabled={operationalDay?.status !== 'open'}>حفظ الشراء</button></div></form>
    <div className="report-card expense-total"><h3>إجمالي المشتريات: {formatMoney(total)}</h3></div>
    <div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th>المجهز</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>
      {purchases.length === 0 ? <tr><td colSpan="7" className="empty-cell">لا توجد مشتريات مسجلة</td></tr> : purchases.slice().reverse().map(row => <tr key={row.id}><td><b>{row.businessDate || row.date || '—'}</b><br/><small>{formatDateTime(row.createdAt || row.date)}</small></td><td>{row.inventory_item_name || row.item}</td><td>{row.quantity}</td><td className="expense-amount">{formatMoney(row.total_after_discount ?? row.total)}</td><td>{row.supplier_name || row.supplier || '—'}</td><td><span className="sync-state disabled">محلي فقط</span></td><td><button type="button" className="history-void" onClick={() => deletePurchase(row.id)} aria-label="حذف عملية الشراء" title="حذف">🗑️ حذف</button></td></tr>)}
    </tbody></table></div>
  </div>
}
