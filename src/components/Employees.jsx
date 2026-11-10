import { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { StaffPinDialog, SystemAdminCodeDialog } from './Dialogs'
import { verifySystemAdminCode } from '../services/systemAdminCode.js'
import { buildPayrollReport, normalizeFixedMonthlySalary } from '../services/salaryService.js'
import { formatNumber } from '../utils.js'

const ROLE_LABELS = { cashier: 'كاشير', employee: 'موظف', manager: 'مدير' }

const emptyForm = { id: '', name: '', code: '', role: 'employee', active: true, canSell: true, fixedMonthlySalary: '' }

export default function Employees({ staff = [], expenses = [], transactions = [], canWrite = false, onSaveStaff, onSaveStaffPin, onNavigate, onStaffSignIn, staffAuthBusy = false, staffAuthError = '' }) {
  const [form, setForm] = useState(emptyForm)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinStaff, setPinStaff] = useState(null)
  const [systemCodeStaff, setSystemCodeStaff] = useState(null)
  const [systemCode, setSystemCode] = useState('')
  const [payrollPeriod, setPayrollPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const currentStaff = useMemo(() => staff.filter(row => row.active !== false), [staff])
  const previousStaff = useMemo(() => staff.filter(row => row.active === false), [staff])
  const payrollByEmployeeId = useMemo(() => {
    const report = buildPayrollReport({ staff, expenses, transactions, payrollPeriod })
    return new Map(report.employees.map(item => [String(item.employeeId), item]))
  }, [staff, expenses, transactions, payrollPeriod])

  const closeForm = () => setForm(emptyForm)
  const ensureStaffAccess = async () => canWrite || Boolean(await onStaffSignIn?.())
  const openNew = async () => { if (await ensureStaffAccess()) setForm(emptyForm) }
  const save = async event => {
    event.preventDefault()
    if (!form.name.trim() || !onSaveStaff) return
    setBusy(true)
    setNotice('')
    try {
      if (!await ensureStaffAccess()) return
      await onSaveStaff({
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        fixedMonthlySalary: normalizeFixedMonthlySalary(form.fixedMonthlySalary)
      })
      closeForm()
      setNotice('تم حفظ بيانات الموظف والتحقق من السجل.')
    } catch (error) {
      setNotice(error?.message || 'تعذر حفظ بيانات الموظف.')
    } finally {
      setBusy(false)
    }
  }

  const edit = async row => { if (await ensureStaffAccess()) setForm({ id: row.id, name: row.name, code: row.code || '', role: row.role || 'employee', active: row.active !== false, canSell: row.canSell !== false, fixedMonthlySalary: row.fixedMonthlySalary ? String(row.fixedMonthlySalary) : '' }) }
  const toggle = async row => {
    setBusy(true)
    setNotice('')
    try {
      if (!await ensureStaffAccess()) return
      await onSaveStaff({ ...row, active: row.active === false })
      setNotice(row.active === false ? 'تمت إعادة تفعيل الموظف.' : 'تم تعطيل الموظف مع الحفاظ على سجله التاريخي.')
    } catch (error) {
      setNotice(error?.message || 'تعذر تحديث حالة الموظف.')
    } finally {
      setBusy(false)
    }
  }
  const canAttemptWrite = canWrite || Boolean(onStaffSignIn)

  const row = person => {
    const payroll = payrollByEmployeeId.get(String(person.id))
    const fixedSalary = normalizeFixedMonthlySalary(person.fixedMonthlySalary)
    return <article className={`employee-management-row ${person.active === false ? 'is-disabled' : ''}`} key={person.id}>
      <div className="employee-management-info">
        <strong>{person.name}</strong>
        <span>الكود: {person.code || 'بدون كود'}</span>
        <span>الدور: {ROLE_LABELS[person.role] || ROLE_LABELS.employee}</span>
        <span>البيع: {person.canSell === false ? 'لا يظهر ككابتن' : 'يظهر ككابتن'}</span>
        <span>الراتب الثابت (المستحق): {formatNumber(fixedSalary)} د.ع</span>
        {payroll && (fixedSalary > 0 || payroll.salaryPaid > 0) && (
          <span>المدفوع ({payrollPeriod}): {formatNumber(payroll.salaryPaid)} د.ع · المتبقي: {formatNumber(payroll.salaryRemaining)} د.ع</span>
        )}
      </div>
      <span className={`employee-management-status ${person.active === false ? 'is-disabled' : ''}`}>{person.active === false ? 'سابق' : 'حالي'}</span>
      <div className="employee-management-actions"><button type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={() => edit(person)}>تعديل</button><button type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={() => toggle(person)}>{person.active === false ? 'إعادة تفعيل' : 'تعطيل'}</button><button type="button" className="pin-action" onClick={() => setSystemCodeStaff(person)}>رمز الدخول</button></div>
    </article>
  }

  return <section className="employees-page" dir="rtl">
    <div className="employees-heading"><div><button type="button" className="back-link" onClick={() => onNavigate('dashboard')}><Icon name="arrow" size={18} /> الرئيسية</button><h1>الموظفين</h1><p>إدارة الموظفين الحاليين والسابقين والرواتب الشهرية الثابتة مع الحفاظ على التاريخ.</p></div><button className="primary-action" type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={openNew}><Icon name="plus" size={18} /> {staffAuthBusy ? 'جارٍ تسجيل الدخول…' : 'إضافة موظف'}</button></div>
    {!canWrite && <div className="settings-readonly" role="status"><p>{staffAuthError || 'يلزم تسجيل الدخول بحساب POS المصرح لإدارة الموظفين.'}</p>{!staffAuthError && <button type="button" className="secondary-action" onClick={onStaffSignIn} disabled={staffAuthBusy}>{staffAuthBusy ? 'جارٍ تسجيل الدخول…' : 'تسجيل دخول'}</button>}</div>}
    <form className="settings-card employee-form" onSubmit={save}>
      <h2>{form.id ? 'تعديل موظف' : 'إضافة موظف'}</h2>
      <div className="employee-form-grid"><label>الاسم *<input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} required /></label><label>الكود<input value={form.code} onChange={event => setForm(value => ({ ...value, code: event.target.value }))} /></label><label>الدور<select value={form.role} onChange={event => setForm(value => ({ ...value, role: event.target.value }))}><option value="cashier">كاشير</option><option value="employee">موظف</option><option value="manager">مدير</option></select></label><label>الراتب الشهري الثابت (د.ع)<input type="number" min="0" step="1000" dir="ltr" placeholder="مثال: 600000" value={form.fixedMonthlySalary ?? ''} onChange={event => setForm(value => ({ ...value, fixedMonthlySalary: event.target.value }))} /></label><label className="staff-seller-toggle"><input type="checkbox" checked={form.canSell} onChange={event => setForm(value => ({ ...value, canSell: event.target.checked }))} /> يظهر ككابتن في البيع</label></div>
      <div className="dialog-actions"><button type="button" className="secondary-action" onClick={closeForm}>إلغاء</button><button className="primary-action" type="submit" disabled={!canAttemptWrite || busy || staffAuthBusy}>{busy || staffAuthBusy ? 'جارٍ الحفظ…' : 'حفظ الموظف'}</button></div>
    </form>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    <section className="settings-card"><div className="settings-card-heading"><div><h2>الموظفون الحاليون</h2><p>{currentStaff.length} موظف</p></div><label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>فترة الراتب:<input type="month" value={payrollPeriod} onChange={e => setPayrollPeriod(e.target.value)} /></label></div><div className="employee-management-list">{currentStaff.length ? currentStaff.map(row) : <p className="settings-readonly">لا يوجد موظفون حاليون.</p>}</div></section>
    <section className="settings-card"><div className="settings-card-heading"><div><h2>الموظفون السابقون</h2><p>{previousStaff.length} موظف — التعطيل لا يحذف المبيعات أو المصاريف التاريخية.</p></div></div><div className="employee-management-list">{previousStaff.length ? previousStaff.map(row) : <p className="settings-readonly">لا يوجد موظفون سابقون.</p>}</div></section>
    {systemCodeStaff && <SystemAdminCodeDialog staff={systemCodeStaff} onClose={() => { setSystemCodeStaff(null); setSystemCode('') }} onVerify={async ({ staff: target, code }) => { if (!verifySystemAdminCode(code)) return false; setSystemCode(code); setSystemCodeStaff(null); setPinStaff(target); return true }} />}
    {pinStaff && <StaffPinDialog staff={pinStaff} systemCode={systemCode} onClose={() => { setPinStaff(null); setSystemCode('') }} onSave={onSaveStaffPin} />}
  </section>
}
