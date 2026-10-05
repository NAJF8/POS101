import { useMemo, useState } from 'react'
import { Icon } from './Icons'

const ROLE_LABELS = { cashier: 'كاشير', employee: 'موظف', manager: 'مدير' }

const emptyForm = { id: '', name: '', code: '', role: 'employee', active: true }

export default function Employees({ staff = [], canWrite = false, onSaveStaff, onNavigate, onStaffSignIn, staffAuthBusy = false, staffAuthError = '' }) {
  const [form, setForm] = useState(emptyForm)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const currentStaff = useMemo(() => staff.filter(row => row.active !== false), [staff])
  const previousStaff = useMemo(() => staff.filter(row => row.active === false), [staff])

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
      await onSaveStaff({ ...form, name: form.name.trim(), code: form.code.trim() })
      closeForm()
      setNotice('تم حفظ بيانات الموظف والتحقق من السجل.')
    } catch (error) {
      setNotice(error?.message || 'تعذر حفظ بيانات الموظف.')
    } finally {
      setBusy(false)
    }
  }

  const edit = async row => { if (await ensureStaffAccess()) setForm({ id: row.id, name: row.name, code: row.code || '', role: row.role || 'employee', active: row.active !== false }) }
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

  const row = person => <article className={`employee-management-row ${person.active === false ? 'is-disabled' : ''}`} key={person.id}>
    <div className="employee-management-info"><strong>{person.name}</strong><span>الكود: {person.code || 'بدون كود'}</span><span>الدور: {ROLE_LABELS[person.role] || ROLE_LABELS.employee}</span></div>
    <span className={`employee-management-status ${person.active === false ? 'is-disabled' : ''}`}>{person.active === false ? 'سابق' : 'حالي'}</span>
    <div className="employee-management-actions"><button type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={() => edit(person)}>تعديل</button><button type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={() => toggle(person)}>{person.active === false ? 'إعادة تفعيل' : 'تعطيل'}</button></div>
  </article>

  return <section className="employees-page" dir="rtl">
    <div className="employees-heading"><div><button type="button" className="back-link" onClick={() => onNavigate('dashboard')}><Icon name="arrow" size={18} /> الرئيسية</button><h1>الموظفين</h1><p>إدارة الموظفين الحاليين والسابقين مع الحفاظ على التاريخ.</p></div><button className="primary-action" type="button" disabled={!canAttemptWrite || staffAuthBusy || busy} onClick={openNew}><Icon name="plus" size={18} /> {staffAuthBusy ? 'جارٍ تسجيل الدخول…' : 'إضافة موظف'}</button></div>
    {!canWrite && <div className="settings-readonly" role="status"><p>{staffAuthError || 'يلزم تسجيل الدخول بحساب POS المصرح لإدارة الموظفين.'}</p>{!staffAuthError && <button type="button" className="secondary-action" onClick={onStaffSignIn} disabled={staffAuthBusy}>{staffAuthBusy ? 'جارٍ تسجيل الدخول…' : 'تسجيل دخول'}</button>}</div>}
    <form className="settings-card employee-form" onSubmit={save}>
      <h2>{form.id ? 'تعديل موظف' : 'إضافة موظف'}</h2>
      <div className="employee-form-grid"><label>الاسم *<input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} required /></label><label>الكود<input value={form.code} onChange={event => setForm(value => ({ ...value, code: event.target.value }))} /></label><label>الدور<select value={form.role} onChange={event => setForm(value => ({ ...value, role: event.target.value }))}><option value="cashier">كاشير</option><option value="employee">موظف</option><option value="manager">مدير</option></select></label></div>
      <div className="dialog-actions"><button type="button" className="secondary-action" onClick={closeForm}>إلغاء</button><button className="primary-action" type="submit" disabled={!canAttemptWrite || busy || staffAuthBusy}>{busy || staffAuthBusy ? 'جارٍ الحفظ…' : 'حفظ الموظف'}</button></div>
    </form>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    <section className="settings-card"><div className="settings-card-heading"><div><h2>الموظفون الحاليون</h2><p>{currentStaff.length} موظف</p></div></div><div className="employee-management-list">{currentStaff.length ? currentStaff.map(row) : <p className="settings-readonly">لا يوجد موظفون حاليون.</p>}</div></section>
    <section className="settings-card"><div className="settings-card-heading"><div><h2>الموظفون السابقون</h2><p>{previousStaff.length} موظف — التعطيل لا يحذف المبيعات أو المصاريف التاريخية.</p></div></div><div className="employee-management-list">{previousStaff.length ? previousStaff.map(row) : <p className="settings-readonly">لا يوجد موظفون سابقون.</p>}</div></section>
  </section>
}
