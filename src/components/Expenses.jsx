import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatDateTime } from '../utils.js'
import { deleteCentralExpense, readCentralExpensesForReports, readLocalExpenses, readLocalOperationalDay, runExpenseCentralSync, saveCentralExpense, saveLocalExpensePending, signInCentralWithGoogle, subscribeCentralExpenses } from '../services/posCentralSync.js'
import { createExpenseRecoveryBackup, createMasterExpenseRecoveryHandler, parseManualExpenseBulk, recoverExpensesFromKnownBackups, scanAllExpenseBackups } from '../services/fullRecoveryController.js'

const format = formatMoney
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
const categories = ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'أخرى']
const people = ['علي', 'روان', 'محمد', 'ميس']

export function Expenses({ onNavigate, onBack, session, operationalDay = null }) {
  const effectiveOperationalDay = operationalDay?.status === 'open' ? operationalDay : readLocalOperationalDay()
  const [expenses, setExpenses] = useState(() => readLocalExpenses())
  const [centralCount, setCentralCount] = useState(null)
  const [centralExpenses, setCentralExpenses] = useState([])
  const [localCount, setLocalCount] = useState(() => readLocalExpenses().length)
  const [centralRefreshing, setCentralRefreshing] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const latest = readLocalExpenses()
      setExpenses(latest)
      setLocalCount(latest.length)
    }
    window.addEventListener('pos101-expenses-updated', refresh)
    const stop = subscribeCentralExpenses((merged, meta = {}) => {
      setExpenses(merged)
      setLocalCount(meta.localCount ?? readLocalExpenses().length)
      if (meta.centralCount !== undefined) setCentralCount(meta.centralCount)
      if (meta.centralExpenses) setCentralExpenses(meta.centralExpenses)
    })
    return () => { window.removeEventListener('pos101-expenses-updated', refresh); stop?.() }
  }, [])
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('مشتريات')
  const [person, setPerson] = useState('علي')
  const [notes, setNotes] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recoveryScan, setRecoveryScan] = useState(null)
  const [selectedRecoveryIds, setSelectedRecoveryIds] = useState([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualText, setManualText] = useState('')
  const [masterRecoveryBusy, setMasterRecoveryBusy] = useState(false)
  const [masterRecoveryStatus, setMasterRecoveryStatus] = useState('')
  const [masterRecoveryResult, setMasterRecoveryResult] = useState(null)
  const masterRecoveryHandler = useMemo(() => createMasterExpenseRecoveryHandler({ onStatus: setMasterRecoveryStatus }), [])

  const runMasterRecovery = async () => {
    if (masterRecoveryBusy) return
    setMasterRecoveryBusy(true)
    setMasterRecoveryResult(null)
    try {
      const result = await masterRecoveryHandler()
      if (result?.skipped) return
      setMasterRecoveryResult(result)
      const latest = readLocalExpenses()
      setExpenses(latest)
      setLocalCount(latest.length)
      setMasterRecoveryStatus('')
    } catch (error) {
      setMasterRecoveryStatus(error?.message || 'تعذر إكمال مزامنة واسترجاع المصاريف.')
    } finally { setMasterRecoveryBusy(false) }
  }

  const refreshCentralExpenses = async () => {
    if (centralRefreshing) return
    setCentralRefreshing(true)
    try {
      const result = await readCentralExpensesForReports({ includeAllLocal: true })
      setExpenses(result.expenses || [])
      setCentralCount(result.centralCount ?? null)
      setCentralExpenses(result.centralExpenses || [])
      setLocalCount(result.localCount ?? readLocalExpenses().length)
      setSyncMessage(`قراءة Firebase فقط: ${result.centralCount || 0} سجل مركزي، الدمج النهائي ${result.mergedCount || 0}.`)
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر قراءة المصاريف من Firebase.')
    } finally { setCentralRefreshing(false) }
  }

  const resetForm = () => { setEditingId(null); setAmount(''); setCategory('مشتريات'); setPerson('علي'); setNotes('') }
  const syncNow = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncMessage('')
    try {
      let result
      try {
        result = await runExpenseCentralSync({ initial: true })
      } catch (error) {
        if (error?.code !== 'AUTH_REQUIRED') throw error
        await signInCentralWithGoogle()
        result = await runExpenseCentralSync({ initial: true })
      }
      setSyncMessage(`تمت المزامنة: رفع ${result?.uploaded || 0}، تخطي ${result?.skipped || 0}، الإجمالي المركزي ${result?.centralCount || 0}`)
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر تنفيذ المزامنة.')
    } finally {
      setSyncing(false)
    }
  }
  const recoverOldExpenses = async () => {
    if (recovering || syncing) return
    setRecovering(true)
    setSyncMessage('')
    try {
      const recovery = recoverExpensesFromKnownBackups()
      const localAfterRecovery = readLocalExpenses()
      setExpenses(localAfterRecovery)

      let syncResult = null
      if (recovery.recoveredCount > 0) {
        try {
          syncResult = await runExpenseCentralSync({ initial: true })
        } catch (error) {
          if (error?.code !== 'AUTH_REQUIRED') throw error
          await signInCentralWithGoogle()
          syncResult = await runExpenseCentralSync({ initial: true })
        }
      }

      const sourceCount = recovery.sources?.length || 0
      const uploaded = syncResult?.uploaded || 0
      const centralCount = syncResult?.centralCount || 0
      if (recovery.recoveredCount > 0) {
        setSyncMessage(`تم الاسترجاع: ${recovery.recoveredCount} مصروف من ${sourceCount} نسخة احتياطية، وتم رفع ${uploaded}، والإجمالي المركزي ${centralCount}.`)
      } else {
        setSyncMessage(`تم فحص ${recovery.scannedBackups || 0} نسخة احتياطية محلية ولم يتم العثور على مصاريف إضافية قابلة للاسترجاع.`)
      }
    } catch (error) {
      setSyncMessage(error?.message || 'تعذر استرجاع المصاريف القديمة.')
    } finally {
      setRecovering(false)
    }
  }
  const scanOldExpenses = () => {
    try {
      const result = scanAllExpenseBackups()
      setRecoveryScan(result)
      setSelectedRecoveryIds(result.candidates.map(row => row.id))
      setSyncMessage(`تم فحص ${result.scannedKeys} مفتاحًا محليًا واكتشاف ${result.newCount} سجل قابل للاسترجاع.`)
    } catch (error) { setSyncMessage(error?.message || 'تعذر فحص النسخ القديمة.') }
  }
  const recoverSelected = async () => {
    const selected = (recoveryScan?.candidates || []).filter(row => selectedRecoveryIds.includes(row.id))
    if (!selected.length) return setSyncMessage('اختر سجلًا واحدًا على الأقل من Preview.')
    setRecovering(true)
    try {
      createExpenseRecoveryBackup(selected)
      selected.forEach(row => saveLocalExpensePending(row))
      setExpenses(readLocalExpenses())
      let uploaded = 0; let pending = selected.length
      try {
        const result = await runExpenseCentralSync({ initial: true })
        uploaded = result?.uploaded || 0
        pending = readLocalExpenses().filter(row => row.syncStatus === 'pending').length
      } catch (error) {
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) throw error
      }
      setSyncMessage(`تمت معالجة الاسترجاع: مستعاد ${selected.length}، مرفوع ${uploaded}، Pending ${pending}، متكرر متخطى ${recoveryScan.duplicateCount}.`)
      setRecoveryScan(null); setSelectedRecoveryIds([])
    } catch (error) { setSyncMessage(error?.message || 'تعذر استرجاع المحدد.') }
    finally { setRecovering(false) }
  }
  const manualPreview = useMemo(() => parseManualExpenseBulk(manualText), [manualText])
  const saveManualBulk = async () => {
    const valid = manualPreview.filter(row => row.valid).map(row => row.expense)
    if (!valid.length) return setSyncMessage('لا توجد أسطر صحيحة للحفظ.')
    setRecovering(true)
    try {
      createExpenseRecoveryBackup(valid)
      valid.forEach(row => saveLocalExpensePending(row))
      setExpenses(readLocalExpenses())
      let uploaded = 0
      try { uploaded = (await runExpenseCentralSync({ initial: true }))?.uploaded || 0 } catch (error) {
        if (!['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) throw error
      }
      const pending = readLocalExpenses().filter(row => row.syncStatus === 'pending').length
      setSyncMessage(`تم حفظ ${valid.length} مصروف يدوي، مرفوع ${uploaded}، Pending ${pending}.`)
      setManualText(''); setManualOpen(false)
    } catch (error) { setSyncMessage(error?.message || 'تعذر حفظ الاسترجاع اليدوي.') }
    finally { setRecovering(false) }
  }

  const submit = async e => {
    e.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !notes.trim()) return alert('يرجى إدخال مبلغ ووصف صحيحين')
    if (editingId) {
      const current = expenses.find(row => row.id === editingId)
      const edited = current ? { ...current, amount: numericAmount, category, person, notes: notes.trim(), description: notes.trim() } : null
      try {
        await saveCentralExpense(edited, { existing: true })
        resetForm(); alert('تم تعديل المصروف بنجاح')
      } catch (error) {
        if (error?.code === 'AUTH_REQUIRED' && edited) {
          saveLocalExpensePending(edited)
          resetForm()
          alert('تم حفظ التعديل محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
        } else alert(error?.message || 'تعذر مزامنة تعديل المصروف.')
      }
      return
    }
    if (effectiveOperationalDay?.status !== 'open' || !effectiveOperationalDay?.id || !effectiveOperationalDay?.businessDate) {
      alert('يجب بدء يوم تشغيلي قبل تسجيل مصروف جديد حتى يُحسب المصروف ضمن نفس فترة العمل.')
      return
    }
    const createdAt = Date.now()
    const row = {
      id: makeId(), amount: numericAmount, category, date: createdAt, createdAt,
      shift: session?.name || 'وردية غير محددة', shiftId: session?.shiftId || session?.cashierId || '', cashierId: session?.cashierId || session?.shiftId || '', person,
      notes: notes.trim(), description: notes.trim(), status: 'disabled',
      operationalDayId: effectiveOperationalDay.id,
      businessDate: effectiveOperationalDay.businessDate,
    }
    try {
      await saveCentralExpense(row)
      resetForm()
    } catch (error) {
      if (['AUTH_REQUIRED', 'NOT_CONFIGURED', 'NETWORK_ERROR', 'NETWORK_REQUEST_FAILED'].includes(error?.code)) {
        saveLocalExpensePending(row)
        resetForm()
        alert('تم حفظ المصروف محليًا — Pending Sync حتى استعادة جلسة المزامنة.')
      } else alert(error?.message || 'تعذر مزامنة المصروف.')
    }
  }
  const beginEdit = expense => { setEditingId(expense.id); setAmount(String(expense.amount)); setCategory(expense.category || 'أخرى'); setPerson(expense.person || 'علي'); setNotes(expense.notes || ''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const confirmDelete = async () => {
    if (!deleting) return
    try { await deleteCentralExpense(deleting); setDeleting(null) } catch (error) { alert(error?.message || 'تعذر مزامنة حذف المصروف.') }
  }
  const total = useMemo(() => expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0), [expenses])
  const allExpenseDiagnostic = useMemo(() => {
    const grouped = expenses.reduce((result, row) => {
      const key = row.businessDate || 'غير محدد'
      result[key] = (result[key] || 0) + Number(row.amount || 0)
      return result
    }, {})
    return { pending: expenses.filter(row => row.syncStatus === 'pending').length, grouped }
  }, [expenses])
  const goBack = onNavigate || onBack

  return (
    <div className="expenses-container" dir="rtl">
      <div className="expenses-header">
        <h2>المصاريف</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="primary-action" type="button" onClick={runMasterRecovery} disabled={syncing || recovering || masterRecoveryBusy}>{masterRecoveryBusy ? 'جاري مزامنة واسترجاع المصاريف...' : 'مزامنة واسترجاع كل المصاريف'}</button>
          <button className="primary-action" onClick={() => goBack?.('dashboard')}>العودة للرئيسية</button>
        </div>
      </div>
      {syncMessage && <div className="report-card" style={{ marginBottom: '1rem' }}><strong>{syncMessage}</strong></div>}
      {masterRecoveryStatus && <div className="report-card" style={{ marginBottom: '1rem' }} role="status"><strong>{masterRecoveryStatus}</strong></div>}
      <div className="report-card" style={{ marginBottom: '1rem' }}>
        <strong>اليوم التشغيلي للمصروف: {effectiveOperationalDay?.status === 'open' && effectiveOperationalDay?.businessDate ? effectiveOperationalDay.businessDate : 'لا يوجد يوم مفتوح'}</strong>
        <div style={{ marginTop: '0.35rem' }}>
          <small>{effectiveOperationalDay?.status === 'open' ? 'أي مصروف جديد يُربط بهذا اليوم حتى لو تجاوز الوقت منتصف الليل.' : 'ابدأ اليوم التشغيلي قبل تسجيل مصروف جديد.'}</small>
        </div>
      </div>
      <form onSubmit={submit} className="expense-form"><div className="expense-form-grid">
        <label>المبلغ (د.ع)<input autoFocus type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label>نوع المصروف<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="expense-notes">صرفته على شنو؟ (الوصف)<input type="text" value={notes} onChange={e => setNotes(e.target.value)} required placeholder="مثال: شراء حليب أو مواد تنظيف..." /></label>
        <label>الموظف<select value={person} onChange={e => setPerson(e.target.value)}>{people.map(value => <option key={value}>{value}</option>)}</select></label>
      </div><div className="expense-form-actions"><button className="primary-action" type="submit" disabled={!editingId && !(effectiveOperationalDay?.status === 'open' && effectiveOperationalDay?.id && effectiveOperationalDay?.businessDate)}>{editingId ? 'حفظ التعديل' : 'حفظ المصروف'}</button>{editingId && <button className="outline-btn" type="button" onClick={resetForm}>إلغاء التعديل</button>}</div></form>
      <div className="report-card expense-total"><h3>إجمالي المصاريف: {format(total)}</h3></div>
      <section className="report-card expense-diagnostic" aria-label="كل المصاريف"><h3>كل المصاريف</h3><p>المصدر المركزي للتقارير هو Firebase RTDB؛ المحلي وPending يُدمجان محافظًا ولا يستبدلان المركزي.</p><div className="recovery-stats"><span>Firebase: <b>{centralCount === null ? 'غير متاح' : centralCount}</b> سجل</span><span>Local: <b>{localCount}</b></span><span>Pending: <b>{allExpenseDiagnostic.pending}</b></span><span>Merged: <b>{expenses.length}</b></span><span>الإجمالي: <b>{format(total)}</b></span></div><div className="diagnostic-groups">{Object.entries(allExpenseDiagnostic.grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, amount]) => <span key={date}>{date}: <b>{format(amount)}</b></span>)}</div>{centralCount !== null && !centralExpenses.some(expense => expense.businessDate === '2026-09-27') && <small>لا يوجد سجل مركزي بتاريخ 2026-09-27؛ السجل موجود محليًا على جهاز آخر أو غير موجود في Firebase.</small>}</section>
      <div className="expenses-table-wrap"><table className="expenses-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الوردية</th><th>الموظف</th><th>الوصف</th><th>إجراءات</th></tr></thead><tbody>
        {expenses.length === 0 ? <tr><td colSpan="7" className="empty-cell">لا توجد مصاريف مسجلة</td></tr> : expenses.slice().reverse().map(expense => <tr key={expense.id}><td><b>{expense.businessDate || '—'}</b><br/><small>{formatDateTime(expense.createdAt ?? expense.date)}</small></td><td>{expense.category}</td><td className="expense-amount">{format(expense.amount)}</td><td>{expense.shift || '—'}</td><td>{expense.person || '—'}</td><td>{expense.notes || '—'}</td><td className="expense-actions"><span className={`sync-state ${expense.syncStatus === 'pending' ? 'pending' : ''}`}>{expense.syncStatus === 'pending' ? 'Pending Sync' : 'Firebase مباشر'}</span><button type="button" className="edit-expense" onClick={() => beginEdit(expense)}>تعديل</button><button type="button" className="delete-expense" onClick={() => setDeleting(expense)}>حذف</button></td></tr>)}
      </tbody></table></div>
      {deleting && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog expense-delete-dialog"><h2>تأكيد حذف المصروف</h2><p>سيتم حذف هذا السجل فقط:</p><dl><div><dt>المبلغ</dt><dd>{format(deleting.amount)}</dd></div><div><dt>النوع</dt><dd>{deleting.category}</dd></div><div><dt>الوصف</dt><dd>{deleting.notes || '—'}</dd></div><div><dt>التاريخ</dt><dd>{formatDateTime(deleting.date)}</dd></div></dl><div className="dialog-actions"><button className="secondary-action" onClick={() => setDeleting(null)}>إلغاء</button><button className="delete-expense" onClick={confirmDelete}>تأكيد الحذف</button></div></div></div>}
      {masterRecoveryResult && <div className="overlay" role="dialog" aria-modal="true"><div className="dialog master-recovery-dialog" dir="rtl"><h2>اكتملت مزامنة المصاريف</h2><p>{masterRecoveryResult.message}</p><dl><div><dt>Local قبل</dt><dd>{masterRecoveryResult.localBefore}</dd></div><div><dt>مرشحات النسخ</dt><dd>{masterRecoveryResult.backupCandidatesFound}</dd></div><div><dt>Firebase قبل</dt><dd>{masterRecoveryResult.firebaseBefore}</dd></div><div><dt>المرفوع</dt><dd>{masterRecoveryResult.uploaded}</dd></div><div><dt>المتكرر المتخطى</dt><dd>{masterRecoveryResult.duplicatesSkipped}</dd></div><div><dt>Pending محفوظ</dt><dd>{masterRecoveryResult.pendingRetained}</dd></div><div><dt>Firebase بعد</dt><dd>{masterRecoveryResult.firebaseAfter}</dd></div><div><dt>الدمج النهائي</dt><dd>{masterRecoveryResult.finalMergedCount}</dd></div><div><dt>الإجمالي</dt><dd>{format(masterRecoveryResult.totalAmount)}</dd></div><div><dt>أيام businessDate</dt><dd>{masterRecoveryResult.businessDateCount}</dd></div></dl><div className="dialog-actions"><button className="primary-action" type="button" onClick={() => setMasterRecoveryResult(null)}>إغلاق</button></div></div></div>}
    </div>
  )
}
