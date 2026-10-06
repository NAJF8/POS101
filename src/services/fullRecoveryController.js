import { centralAuth, ensureKioskFirebaseSession, isAuthorizedPosSyncUser, readCentralExpensesForReports, readLocalExpenses, runExpenseCentralSync, runFullRecoverySync, saveLocalExpensePending } from './posCentralSync.js'
import { areExpenseDuplicates, getExpensesForBusinessDate, getLocalDateKey, normalizeDateKey, normalizeExpense, normalizeTimestamp, resolveExpenseBusinessDate, safeCreatedAtForBusinessDate } from './expenseReporting.js'

const readJson = (key, fallback) => {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value === null ? fallback : value } catch { return fallback }
}

export const createFullRecoveryBackup = () => {
  const timestamp = new Date().toISOString()
  const key = `pos101.fullRecoveryBackup.${timestamp}`
  const snapshot = {
    timestamp,
    sales: readJson('pos101.sales', []),
    expenses: readJson('pos101.expenses', []),
    operationalDay: readJson('pos101.operationalDay', null),
    session: readJson('pos101.session', null),
    deviceId: localStorage.getItem('pos101.deviceId') || '',
  }
  localStorage.setItem(key, JSON.stringify(snapshot))
  return { key, timestamp, snapshot }
}

const hasExpenseContext = value => ['businessDate', 'date', 'createdAt', 'notes', 'description', 'category']
  .some(key => value?.[key] !== undefined && value?.[key] !== null && String(value[key]).trim() !== '')
const normalizeNumericText = value => String(value ?? '').replace(/[،٬,]/g, '').replace(/[٠-٩۰-۹]/g, digit => {
  const index = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)
  return String(index >= 10 ? index - 10 : index)
})

export const isExpenseCandidate = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const amount = Number(normalizeNumericText(value.amount))
  return Number.isFinite(amount) && amount > 0 && hasExpenseContext(value)
}

const collectExpenseCandidates = (value, path, output, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (isExpenseCandidate(value)) output.push({ raw: value, path })
  if (Array.isArray(value)) value.forEach((child, index) => collectExpenseCandidates(child, `${path}[${index}]`, output, seen))
  else Object.entries(value).forEach(([key, child]) => {
    if (child && typeof child === 'object') collectExpenseCandidates(child, `${path}.${key}`, output, seen)
  })
}

const readOperationalDayDates = () => {
  const value = readJson('pos101_operational_days', {})
  const entries = Array.isArray(value) ? value.map(row => [row?.id || row?.operationalDayId, row]) : Object.entries(value || {})
  return Object.fromEntries(entries.map(([id, row]) => [String(id || row?.operationalDayId || ''), normalizeDateKey(row?.businessDate)]).filter(([id, date]) => id && date))
}

const validRecoveryId = value => {
  const id = String(value || '').trim()
  return Boolean(id) && !/[.#$\[\]/]/.test(id)
}

const safeRecoveryCreatedAt = businessDate => {
  return safeCreatedAtForBusinessDate(businessDate) || Date.now()
}

const normalizeRecoveredExpense = (raw, operationalDayDates) => {
  const businessDate = resolveExpenseBusinessDate(raw, { operationalDayDates }) || getLocalDateKey(raw?.date || raw?.createdAt)
  const amount = Number(normalizeNumericText(raw?.amount))
  const explicitCreatedAt = normalizeTimestamp(raw?.createdAt || raw?.created_at || raw?.timestamp || raw?.date)
  const createdAt = explicitCreatedAt || (businessDate ? safeRecoveryCreatedAt(businessDate) : 0)
  return {
    ...normalizeExpense({ ...raw, amount, businessDate, createdAt, date: raw?.date || createdAt }),
    amount,
    businessDate,
    createdAt,
    timestamp: createdAt,
    id: validRecoveryId(raw?.id || raw?.expenseId) ? String(raw.id || raw.expenseId) : `recovered-expense-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    category: String(raw?.category || raw?.type || 'أخرى').trim() || 'أخرى',
    person: String(raw?.person || raw?.employee || raw?.cashierName || '').trim() || 'غير محدد',
    notes: String(raw?.notes || raw?.description || '').trim(),
    description: String(raw?.description || raw?.notes || '').trim(),
  }
}

export const scanAllExpenseBackups = () => {
  const existing = readLocalExpenses()
  const currentLedger = readJson('pos101.expenses', [])
  const operationalDayDates = readOperationalDayDates()
  const candidates = []
  const keys = []
  if (Array.isArray(currentLedger)) currentLedger.forEach((raw, index) => collectExpenseCandidates(raw, `current-local-ledger[${index}]`, candidates))
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue
    keys.push(key)
    const value = readJson(key, null)
    if (value !== null && key !== 'pos101.expenses') collectExpenseCandidates(value, key, candidates)
  }
  const recovered = []
  for (const candidate of candidates) {
    const row = normalizeRecoveredExpense(candidate.raw, operationalDayDates)
    const valid = row.amount > 0 && Boolean(normalizeDateKey(row.businessDate))
    const currentLedgerSource = candidate.path.startsWith('current-local-ledger')
    recovered.push({ ...row, recoverySource: currentLedgerSource ? 'current-local-ledger' : candidate.path, source: currentLedgerSource ? 'current-local-ledger' : candidate.path, recoveryStatus: valid ? 'جديد' : 'غير محدد', candidateStatus: valid ? 'VALID' : 'INVALID', candidateReason: valid ? 'businessDate و amount صالحان' : 'المبلغ أو businessDate غير صالح' })
  }
  const invalidCount = recovered.filter(row => row.candidateStatus === 'INVALID').length
  return {
    scannedKeys: keys.length,
    currentCount: existing.length,
    candidatesCount: candidates.length,
    newCount: recovered.filter(row => row.candidateStatus === 'VALID').length,
    duplicateCount: 0,
    invalidCount,
    withoutDateCount: recovered.filter(row => !row.businessDate).length,
    recoverableTotal: recovered.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    candidates: recovered,
    sources: [...new Set(recovered.map(row => row.recoverySource))],
    localLedger: recovered.filter(row => row.recoverySource === 'current-local-ledger'),
  }
}

const normalizedRecoveryText = value => String(value || '').trim().toLocaleLowerCase()
const recoveryPerson = row => normalizedRecoveryText(row?.person || row?.cashier || row?.cashierName || row?.cashierNameSnapshot || row?.cashierId)

const isStrongRecoveryDuplicate = (candidate, remote, toleranceMs = 2 * 60 * 1000) => {
  const left = normalizeExpense(candidate)
  const right = normalizeExpense(remote)
  const leftPerson = recoveryPerson(left)
  const rightPerson = recoveryPerson(right)
  return left.amount > 0 && left.amount === right.amount
    && normalizeDateKey(left.businessDate) === normalizeDateKey(right.businessDate)
    && normalizedRecoveryText(left.description || left.notes) === normalizedRecoveryText(right.description || right.notes)
    && Boolean(leftPerson && rightPerson && leftPerson === rightPerson)
    && Boolean(left.createdAt && right.createdAt && Math.abs(left.createdAt - right.createdAt) <= toleranceMs)
}

export const classifyRecoveryCandidates = (candidates = [], centralExpenses = []) => (Array.isArray(candidates) ? candidates : []).map(candidate => {
  const row = normalizeRecoveredExpense(candidate, {})
  const idDuplicate = centralExpenses.find(remote => validRecoveryId(row.id) && String(remote?.id || remote?.expenseId || '') === row.id)
  if (row.amount <= 0 || !normalizeDateKey(row.businessDate)) return { ...row, candidateStatus: 'INVALID', decision: 'INVALID', reason: 'المبلغ أو businessDate غير صالح' }
  if (idDuplicate) return { ...row, candidateStatus: 'VALID', decision: 'DUPLICATE', reason: 'نفس id موجود فعليًا في Firebase' }
  const strongDuplicate = centralExpenses.find(remote => isStrongRecoveryDuplicate(row, remote))
  if (strongDuplicate) return { ...row, candidateStatus: 'VALID', decision: 'DUPLICATE', reason: 'تطابق قوي: businessDate والمبلغ والوصف والشخص وcreatedAt ضمن tolerance' }
  return { ...row, candidateStatus: 'VALID', decision: 'UNIQUE', reason: 'لا يوجد id أو تطابق قوي في Firebase' }
})

export const createExpenseRecoveryBackup = selectedExpenses => {
  const timestamp = new Date().toISOString()
  const key = `pos101.expenseRecoveryBackup.${timestamp}`
  const snapshot = {
    timestamp,
    currentExpenses: readLocalExpenses(),
    selectedRecoveredExpenses: selectedExpenses,
    operationalDayCache: readJson('pos101.operationalDay', null),
    operationalDays: readJson('pos101_operational_days', null),
    deviceId: localStorage.getItem('pos101.deviceId') || '',
  }
  localStorage.setItem(key, JSON.stringify(snapshot))
  return { key, timestamp, snapshot }
}

export const parseManualExpenseBulk = text => String(text || '').split(/\r?\n/).map((line, index) => {
  const parts = line.split('|').map(value => value.trim())
  if (!line.trim()) return null
  const [date, amountText, category, person, description] = parts
  const amount = Number(normalizeNumericText(amountText))
  const businessDate = normalizeDateKey(date)
  const errors = []
  if (!businessDate) errors.push('التاريخ غير صحيح')
  if (!Number.isFinite(amount) || amount <= 0) errors.push('المبلغ غير صحيح')
  if (parts.length > 5) errors.push('عدد الحقول أكبر من 5')
  return { line: index + 1, raw: line, valid: errors.length === 0, errors, expense: { id: `manual-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`}`, amount, businessDate, category: category || 'أخرى', person: person || 'غير محدد', notes: description || category || 'أخرى', description: description || category || 'أخرى', createdAt: Date.parse(`${businessDate}T12:00:00+03:00`), recoverySource: 'manual-bulk-recovery', shift: 'استرجاع يدوي', syncStatus: 'pending' } }
}).filter(Boolean)

export const recoverExpensesFromKnownBackups = () => {
  const scan = scanAllExpenseBackups()
  scan.candidates.forEach(row => saveLocalExpensePending(row))
  return { ...scan, recoveredCount: scan.newCount, localCountBefore: scan.currentCount, localCountAfter: readLocalExpenses().length }
}

export const createMasterExpenseRecoveryBackup = user => {
  const timestamp = new Date().toISOString()
  const key = `pos101.masterExpenseRecoveryBackup.${timestamp}`
  const expenses = readLocalExpenses()
  const recoveryKeys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index)
    if (storageKey && /expense|expenses|recovery|backup|pos101/i.test(storageKey)) recoveryKeys.push(storageKey)
  }
  const snapshot = {
    timestamp,
    expenses,
    pendingExpenses: expenses.filter(row => row.syncStatus === 'pending'),
    operationalDay: readJson('pos101.operationalDay', null),
    operationalDays: readJson('pos101_operational_days', null),
    deviceId: localStorage.getItem('pos101.deviceId') || '',
    user: { uid: user?.uid || '', email: user?.email || '' },
    expenseRecoveryBackupKeys: recoveryKeys,
  }
  localStorage.setItem(key, JSON.stringify(snapshot))
  return { key, timestamp, snapshot }
}

export const createMasterExpenseRecoveryHandler = ({
  getCurrentUser = () => centralAuth()?.currentUser,
  signIn = ensureKioskFirebaseSession,
  readCentral = readCentralExpensesForReports,
  syncCentral = runExpenseCentralSync,
  onStatus,
} = {}) => {
  let busy = false
  return async () => {
    if (busy) return { skipped: true }
    busy = true
    let backup = null
    try {
      onStatus?.('جاري التحقق من الصلاحيات...')
      const user = getCurrentUser() || await signIn()
      if (!await isAuthorizedPosSyncUser(user)) throw Object.assign(new Error('هذا الحساب غير مخول لمزامنة المصاريف.'), { code: 'CENTRAL_ROLE_BLOCKED' })

      onStatus?.('جاري فحص المصاريف المحلية...')
      const scan = scanAllExpenseBackups()
      onStatus?.('جاري إنشاء نسخة احتياطية...')
      backup = createMasterExpenseRecoveryBackup(user)
      onStatus?.('جاري قراءة Firebase...')
      const before = await readCentral({ includeAllLocal: true })

      const diagnostics = classifyRecoveryCandidates(scan.candidates, before.centralExpenses || [])
      diagnostics.filter(row => row.decision === 'UNIQUE').forEach(row => saveLocalExpensePending(row))

      onStatus?.('جاري دمج البيانات...')
      onStatus?.('جاري رفع السجلات الناقصة...')
      const upload = await syncCentral({ initial: true })

      onStatus?.('جاري التحقق النهائي...')
      const after = await readCentral({ includeAllLocal: true })
      const pendingRetained = after.expenses.filter(row => row.syncStatus === 'pending').length
      const uniqueCandidates = diagnostics.filter(row => row.decision === 'UNIQUE')
      const duplicateCandidates = diagnostics.filter(row => row.decision === 'DUPLICATE')
      const invalidCandidates = diagnostics.filter(row => row.decision === 'INVALID')
      const invariantOk = after.centralCount >= before.centralCount + upload.uploaded
      const uploadFailureMessage = uniqueCandidates.length > 0 && upload.uploaded === 0
        ? `تم العثور على ${uniqueCandidates.length} سجل قديم لكن تعذر رفعها: ${upload.retainedPending ? `${upload.retainedPending} Pending` : 'تعذر التحقق من الرفع'}.`
        : null
      const totalAmount = after.expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0)
      const countByDate = rows => rows.reduce((result, row) => {
        const date = normalizeDateKey(row.businessDate) || 'غير محدد'
        result[date] = (result[date] || 0) + 1
        return result
      }, {})
      const localByDate = countByDate(scan.localLedger)
      const firebaseBeforeByDate = countByDate(before.centralExpenses || [])
      const firebaseAfterByDate = countByDate(after.centralExpenses || [])
      const uploadedByDate = {}
      for (const row of uniqueCandidates) {
        if ((after.centralExpenses || []).some(remote => String(remote.id || remote.expenseId || '') === String(row.id))) {
          const date = normalizeDateKey(row.businessDate) || 'غير محدد'
          uploadedByDate[date] = (uploadedByDate[date] || 0) + 1
        }
      }
      const targetDate = '2026-09-27'
      const result = {
        backup,
        localBefore: backup.snapshot.expenses.length,
        candidatesFound: diagnostics.length,
        backupCandidatesFound: diagnostics.length,
        firebaseBefore: before.centralCount,
        uploaded: upload.uploaded,
        uniqueCandidates: uniqueCandidates.length,
        duplicatesSkipped: duplicateCandidates.length + upload.skipped,
        duplicateCandidates: duplicateCandidates.length,
        invalidCandidates: invalidCandidates.length,
        candidateDiagnostics: diagnostics,
        pendingRetained,
        firebaseAfter: after.centralCount,
        invariantOk,
        finalMergedCount: after.mergedCount,
        totalAmount,
        businessDateCount: new Set(after.expenses.map(row => row.businessDate).filter(Boolean)).size,
        dateDiagnostics: Object.fromEntries([...new Set([...Object.keys(localByDate), ...Object.keys(firebaseBeforeByDate), ...Object.keys(firebaseAfterByDate)])].map(date => [date, { local: localByDate[date] || 0, firebaseBefore: firebaseBeforeByDate[date] || 0, uploaded: uploadedByDate[date] || 0, firebaseAfter: firebaseAfterByDate[date] || 0 }])),
        reportVerification: { date: targetDate, centralCount: getExpensesForBusinessDate(after.centralExpenses || [], targetDate).length, pass: getExpensesForBusinessDate(after.centralExpenses || [], targetDate).length > 0 },
        message: uploadFailureMessage || (!invariantOk
          ? `تعذر إثبات إضافة كل السجلات: Firebase قبل ${before.centralCount} وبعد ${after.centralCount}.`
          : upload.uploaded > 0
          ? `تم رفع ${upload.uploaded} سجل قديم إلى Firebase.`
          : `لم يتم العثور على سجلات قديمة فريدة قابلة للرفع (${duplicateCandidates.length} مكرر، ${invalidCandidates.length} غير صالح).`),
      }
      return result
    } finally {
      busy = false
    }
  }
}

export const createFullRecoveryClickHandler = ({ getCurrentUser = () => centralAuth()?.currentUser, signIn = ensureKioskFirebaseSession, runRecovery = runFullRecoverySync, onStart, onSuccess, onError } = {}) => {
  let busy = false
  return async function handleFullRecoveryClick() {
    if (busy) return { skipped: true }
    busy = true
    let backup = null
    try {
      const user = getCurrentUser() || await signIn()
      if (!await isAuthorizedPosSyncUser(user)) throw Object.assign(new Error('هذا الحساب غير مخول لإصلاح ومزامنة بيانات POS.'), { code: 'CENTRAL_ROLE_BLOCKED' })
      backup = createFullRecoveryBackup()
      onStart?.(backup)
      const result = await runRecovery()
      const complete = { backup, ...result }
      onSuccess?.(complete)
      return complete
    } catch (error) {
      const failure = { error, backup }
      onError?.(failure)
      return failure
    } finally { busy = false }
  }
}
