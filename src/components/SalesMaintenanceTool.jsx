import { useMemo, useState } from 'react'
import { buildSalesMaintenancePlan, runSalesMaintenance } from '../services/salesMaintenance.js'
import { formatNumber } from '../utils.js'

const readCurrent = () => {
  try {
    const value = JSON.parse(localStorage.getItem('pos101.sales') || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const orderList = values => values.length ? values.join('، ') : 'لا يوجد'

export default function SalesMaintenanceTool({ onClose }) {
  const [sales, setSales] = useState(readCurrent)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const plan = useMemo(() => buildSalesMaintenancePlan(sales), [sales])

  const refreshPreview = () => {
    setSales(readCurrent())
    setResult(null)
    setError('')
  }

  const execute = () => {
    setError('')
    try {
      const next = runSalesMaintenance()
      setSales(next.after.preservedRows)
      setResult(next)
      window.dispatchEvent(new CustomEvent('pos101-sales-updated'))
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="sales-maintenance-title">
      <div className="dialog sales-maintenance-dialog" dir="rtl">
        <button className="close" onClick={onClose} aria-label="إغلاق"><span aria-hidden="true">×</span></button>
        <h2 id="sales-maintenance-title">تنظيف الطلبات القديمة</h2>
        <p className="maintenance-warning">هذه أداة إدارة مؤقتة. سيتم حذف الطلبات #1023–#1050 فقط من <code>pos101.sales</code>. الطلبات الجديدة الأكبر من #1052 محفوظة.</p>
        <dl className="maintenance-summary">
          <div><dt>العدد الحالي</dt><dd>{formatNumber(plan.currentCount)}</dd></div>
          <div><dt>سيتم حذفها</dt><dd>{formatNumber(plan.deleteRows.length)} ({orderList(plan.deleteOrderNumbers)})</dd></div>
          <div><dt>#1051</dt><dd>{plan.required[0].count ? 'موجود' : 'غير موجود'}</dd></div>
          <div><dt>#1052</dt><dd>{plan.required[1].count ? 'موجود' : 'غير موجود'}</dd></div>
          <div><dt>طلبات &gt;1052</dt><dd>{formatNumber(plan.newRows.length)} ({orderList(plan.newRows.map(row => row.orderNumber))})</dd></div>
          <div><dt>saleId مكررة</dt><dd>{formatNumber(plan.duplicateSaleIds.length)}</dd></div>
        </dl>
        <p className="maintenance-note">قبل الكتابة سيُعاد قراءة الحالة الحالية، ويُنزّل Backup جديد، ثم تُجرى عملية read-back للتحقق.</p>
        {error && <p className="maintenance-error" role="alert">لم يتم الحذف: {error}</p>}
        {result && <div className="maintenance-success" role="status">
          <strong>تم تنظيف الطلبات القديمة بنجاح</strong>
          <span>Before: {formatNumber(result.before.currentCount)} · Deleted: {formatNumber(result.deletedCount)} · After: {formatNumber(result.after.currentCount)}</span>
          <span>Preserved: #{formatNumber(1051)}، #{formatNumber(1052)}، والطلبات الأكبر من #1052</span>
          <span>Backup: {result.filename}</span>
        </div>}
        <div className="maintenance-actions">
          <button type="button" onClick={refreshPreview}>إعادة قراءة الحالة</button>
          <button type="button" className="danger-button" onClick={execute} disabled={Boolean(result) || plan.deleteRows.length === 0 || plan.required.some(item => item.count === 0) || plan.duplicateSaleIds.length > 0}>تأكيد حذف #1023–#1050</button>
        </div>
      </div>
    </div>
  )
}
