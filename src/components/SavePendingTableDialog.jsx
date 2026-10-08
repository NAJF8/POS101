import { useState } from 'react'

export default function SavePendingTableDialog({ onClose, onSave, total, session }) {
  const [customerName, setCustomerName] = useState('')
  const [tableNumber, setTableNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (!customerName.trim()) { setError('اسم الزبون مطلوب.'); return }
    setBusy(true); setError('')
    try { await onSave({ customerName, tableNumber, phone, note }); onClose() } catch (e) { setError(e?.message || 'تعذر حفظ الطاولة المعلقة.') } finally { setBusy(false) }
  }
  return <div className="overlay"><form className="dialog pending-create-dialog" dir="rtl" onSubmit={submit}><h2>حفظ كطاولة معلقة</h2><p>الإجمالي الحالي: <b>{Number(total || 0).toLocaleString('ar-IQ')} د.ع</b></p><label>اسم الزبون *<input autoFocus value={customerName} onChange={e => setCustomerName(e.target.value)} required /></label><label>رقم الطاولة (اختياري)<input value={tableNumber} onChange={e => setTableNumber(e.target.value)} /></label><label>الهاتف (اختياري)<input value={phone} onChange={e => setPhone(e.target.value)} /></label><label>ملاحظة (اختياري)<textarea value={note} onChange={e => setNote(e.target.value)} /></label><p className="pending-form-note">لن تُحسب هذه الطاولة كمبيعات ولن تؤثر على الصندوق حتى تحصيل الدفع.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="secondary-action" type="button" onClick={onClose}>إلغاء</button><button className="primary-action" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الطاولة المعلقة'}</button></div></form></div>
}
