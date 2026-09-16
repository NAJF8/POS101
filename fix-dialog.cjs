const fs = require('fs');
let code = fs.readFileSync('src/components/Dialogs.jsx', 'utf8');
const printMenuRegex = /export function PrintMenu[\s\S]*?<\/Dialog>\n  }/;

const newPrintMenu = `export function PrintMenu({ enabled, settings, onClose, onChange, onSave }) {
  const [printerName, setPrinterName] = React.useState(settings?.name || '')
  const save = () => {
    onSave({ name: printerName.trim(), paper: '80mm' })
    onClose()
  }
  return (
    <Dialog onClose={onClose} className="print-menu">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'right' }}>
        <h2>إعداد الطباعة</h2>
        <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5' }}>تُحفظ هذه الإعدادات محلياً على هذا الكاشير. يمكنك تشغيل الطباعة التلقائية للفواتير الحرارية (80mm) بعد إتمام البيع.</p>
        
        <label className="printer-name-field" style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontWeight: 'bold' }}>
          اسم الطابعة الحرارية (80mm)
          <input value={printerName} onChange={e => setPrinterName(e.target.value)} placeholder="مثال: POS-80" style={{ padding: '10px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'inherit' }} />
        </label>
        
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button type="button" className={enabled ? 'selected primary-action' : ''} onClick={() => onChange(true)} style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', border: '1px solid #ccc', borderRadius: '6px', background: enabled ? 'var(--coffee)' : '#fff', color: enabled ? '#fff' : '#000' }}>
            <b style={{ fontSize: '16px' }}>تشغيل الطباعة</b>
            <small style={{ opacity: 0.8, textAlign: 'center' }}>تُطبع الفاتورة وتُحفظ كعملية تاريخية</small>
          </button>
          <button type="button" className={!enabled ? 'selected primary-action' : ''} onClick={() => onChange(false)} style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', border: '1px solid #ccc', borderRadius: '6px', background: !enabled ? 'var(--coffee)' : '#fff', color: !enabled ? '#fff' : '#000' }}>
            <b style={{ fontSize: '16px' }}>إيقاف الطباعة</b>
            <small style={{ opacity: 0.8, textAlign: 'center' }}>تُحفظ العملية بدون طباعة ورقية</small>
          </button>
        </div>
        
        <div className="actions" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button type="button" className="outline-btn" onClick={onClose} style={{ flex: 1, padding: '12px' }}>إلغاء</button>
          <button type="button" className="primary-action" onClick={save} style={{ flex: 1, padding: '12px' }}>حفظ الإعدادات</button>
        </div>
      </div>
    </Dialog>
  )
}`;

code = code.replace(printMenuRegex, newPrintMenu);
fs.writeFileSync('src/components/Dialogs.jsx', code);
console.log('Fixed PrintMenu');
