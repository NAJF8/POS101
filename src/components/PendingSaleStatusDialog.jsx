const formatMoney = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`

const statusText = status => ({
  EXISTS_ONCE: 'الطلب موجود مركزيًا وتمت مطابقة البيانات',
  MISSING: 'الطلب غير موجود مركزيًا؛ يمكن محاولة الرفع الآمن',
  DUPLICATE: 'تم العثور على أكثر من تطابق؛ أوقفنا إعادة الرفع',
  RESOLVED: 'تم رفع الطلب مركزيًا',
}[status] || 'بانتظار فحص Firebase')

export default function PendingSaleStatusDialog({ entries = [], check = null, busy = false, onCheck, onRetry, onClose }) {
  const entry = entries[0] || check?.items?.[0] || null
  const itemStatus = check?.items?.[0]?.status
  const resolved = check?.status === 'RESOLVED' || (check?.remaining === 0 && check?.reconciled > 0)
  return (
    <div className="overlay pending-sale-overlay" role="dialog" aria-modal="true" aria-labelledby="pending-sale-title">
      <div className="dialog pending-sale-dialog" dir="rtl">
        <button className="close" type="button" onClick={onClose} aria-label="إغلاق حالة الطلب">×</button>
        <h2 id="pending-sale-title">{resolved ? 'تم رفع الطلب مركزيًا' : 'الطلب محفوظ بانتظار المزامنة'}</h2>
        <p>{resolved ? 'تم تأكيد الطلب في Firebase ولم تتم إعادة بيعه.' : 'لم يتم تأكيد الطلب مركزيًا بسبب الاتصال. لا تعيد البيع. سيتم رفع الطلب تلقائيًا عند عودة الاتصال.'}</p>
        {entry && (
          <dl className="pending-sale-details">
            <div><dt>رقم الطلب</dt><dd>{entry.orderNumber || '—'}</dd></div>
            <div><dt>الإجمالي</dt><dd>{formatMoney(entry.total)}</dd></div>
            <div><dt>المحاولات</dt><dd>{entry.attempts ?? 0}</dd></div>
            <div><dt>الحالة</dt><dd>{statusText(itemStatus || check?.status)}</dd></div>
          </dl>
        )}
        {check?.firebaseRead === 'FAIL' && <p className="pending-sale-error">تعذر قراءة Firebase: {check.error || check.errorCode || 'READ_FAILED'}</p>}
        {check?.items?.some(item => item.status === 'DUPLICATE') && <p className="pending-sale-error">تم إيقاف الرفع لتجنب إنشاء نسخة مكررة. لا تحذف الطابور ولا تعِد البيع.</p>}
        <div className="dialog-actions pending-sale-actions">
          <button type="button" className="primary-action" onClick={onCheck} disabled={busy}>{busy ? 'جارٍ الفحص…' : 'فحص المزامنة'}</button>
          <button type="button" className="primary-action" onClick={onRetry} disabled={busy || resolved}>{busy ? 'جارٍ المحاولة…' : 'محاولة الرفع الآن'}</button>
          <button type="button" className="secondary-action" onClick={onClose} disabled={busy}>رجوع</button>
        </div>
      </div>
    </div>
  )
}
