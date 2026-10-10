const formatMoney = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`

const statusText = status => ({
  EXISTS_ONCE: 'موجود مرة واحدة',
  MISSING: 'غير موجود مركزيًا',
  DUPLICATE: 'تعارض/تكرار',
  resolved: 'تم الحل',
  pending_local_confirmation: 'بانتظار التأكيد',
}[status] || status || 'غير معروف')

export default function CentralPendingDiagnostics({ rows = [], report = null, busy = false, onRefresh, onReconcile }) {
  return (
    <section className="admin-pending-diagnostics settings-card" dir="rtl" aria-label="تشخيص المبيعات المعلقة مركزيًا">
      <div className="admin-pending-diagnostics-head">
        <div>
          <h2>تشخيص المبيعات المعلّقة مركزيًا</h2>
          <p>قراءة آمنة من Firebase لسجلات التنبيه فقط؛ لا تُنشئ مبيعات ولا تغيّر التقارير.</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void onRefresh?.()}>{busy ? 'جارٍ الفحص…' : 'تحديث التشخيص'}</button>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void onReconcile?.()}>{busy ? 'جارٍ التسوية…' : 'فحص وتسوية المطابق فقط'}</button>
        </div>
      </div>
      {report?.firebaseRead === 'FAIL' && <p className="form-error" role="alert">تعذر قراءة التشخيص المركزي: {report.error || 'READ_FAILED'}</p>}
      {report?.firebaseRead === 'PASS' && <p className="settings-readonly">نتيجة آخر فحص: تم حل {report.resolved || 0} · مفقود {report.missing || 0} · تعارض {report.duplicates || 0} · إنشاء مبيعات {report.salesCreated || 0}</p>}
      {!rows.length && <p role="status">لا توجد تنبيهات مركزية غير محلولة.</p>}
      {rows.length > 0 && <div className="admin-pending-diagnostics-list">
        {rows.map(row => {
          const result = report?.results?.find(item => item.diagnosticKey === row.diagnosticKey || (item.saleId === row.saleId && item.operationKey === row.operationKey))
          return <article className="admin-pending-diagnostic-card" key={row.diagnosticKey || row.operationKey || row.saleId}>
            <div className="admin-pending-diagnostic-title"><strong>طلب {row.orderNumber || '—'}</strong><span>{statusText(result?.status || row.status)}</span></div>
            <dl>
              <div><dt>saleId</dt><dd dir="ltr">{row.saleId || '—'}</dd></div>
              <div><dt>operationKey</dt><dd dir="ltr">{row.operationKey || '—'}</dd></div>
              <div><dt>التاريخ / اليوم</dt><dd>{row.businessDate || '—'} · {row.operationalDayId || '—'}</dd></div>
              <div><dt>الإجمالي / العناصر</dt><dd>{formatMoney(row.total)} · {row.itemCount || 0}</dd></div>
              <div><dt>الكاشير / الجهاز</dt><dd>{row.cashier || '—'} · {row.kioskId || row.deviceId || '—'}</dd></div>
              <div><dt>آخر خطأ</dt><dd>{row.lastError || '—'}</dd></div>
            </dl>
            <p className="settings-readonly">{result?.actionSuggestion || (row.status === 'resolved' ? 'تم الحل بعد readback.' : 'اضغط فحص وتسوية المطابق فقط.')}</p>
          </article>
        })}
      </div>}
    </section>
  )
}
