import React from 'react'
import { formatNumber } from '../utils.js'

const count = value => formatNumber(Number(value || 0))

const downloadBackup = backup => {
  if (!backup?.snapshot) return
  const blob = new Blob([JSON.stringify(backup.snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `pos101-full-recovery-backup-${backup.timestamp.replace(/[:.]/g, '-')}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export default function FullRecoveryDialog({ result, onClose }) {
  const failed = Boolean(result?.error)
  const data = result || {}
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="full-recovery-title">
    <section className="dialog full-recovery-dialog" dir="rtl">
      <h2 id="full-recovery-title">{failed ? 'اكتملت العملية جزئيًا' : 'تم إصلاح ومزامنة النظام ✅'}</h2>
      <p>{failed ? 'لم يتم حذف أي بيانات. النسخة الاحتياطية محفوظة والسجلات المحلية المعلقة بقيت كما هي.' : 'تم تنفيذ الدمج الآمن دون استبدال البيانات المحلية.'}</p>
      {failed && <p className="form-error" role="alert">{data.error?.message || 'تعذر إكمال العملية.'}</p>}
      {!failed && <>
        <div className="full-recovery-grid">
          <div><h3>الطلبات</h3><p>محلي: {count(data.sales?.localCount)}</p><p>تم الرفع: {count(data.sales?.uploaded)}</p><p>المركزي: {count(data.sales?.centralCount)}</p><p>المكررة المتخطاة: {count(data.sales?.duplicatesSkipped)}</p></div>
          <div><h3>المصاريف</h3><p>محلي: {count(data.expenses?.localCount)}</p><p>تم الرفع: {count(data.expenses?.uploaded)}</p><p>المركزي: {count(data.expenses?.centralCount)}</p><p>المعلقة: {count(data.expenses?.pending)}</p></div>
        </div>
        <div className="full-recovery-health"><span>اليوم التشغيلي: <b>{data.operationalDay?.status === 'open' ? 'مفتوح' : 'مغلق'}</b></span><span>المزامنة المباشرة: <b>{data.realtime?.salesConnected && data.realtime?.expensesConnected ? 'متصل' : 'غير مكتمل'}</b></span></div>
      </>}
      {data.backup ? <p className="full-recovery-backup">النسخة الاحتياطية: تم إنشاؤها</p> : <p className="full-recovery-backup">لم يتم تعديل البيانات المحلية.</p>}
      <div className="dialog-actions">{data.backup && <button className="secondary-action" type="button" onClick={() => downloadBackup(data.backup)}>تنزيل JSON</button>}<button className="primary-action" type="button" onClick={onClose}>إغلاق</button></div>
    </section>
  </div>
}
