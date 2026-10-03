import { centralAuth, isAuthorizedPosSyncUser, readLocalExpenses, runFullRecoverySync, saveLocalExpensePending, signInCentralWithGoogle } from './posCentralSync.js'
import { areExpenseDuplicates, normalizeExpense } from './expenseReporting.js'

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

const knownExpenseBackupPrefixes = [
  'pos101.fullRecoveryBackup.',
  'pos101.expenses.recoveryBackup.',
]

const expenseRowsFromBackupValue = value => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.expenses)) return value.expenses
  if (Array.isArray(value?.records)) return value.records
  if (Array.isArray(value?.snapshot?.expenses)) return value.snapshot.expenses
  return []
}

export const recoverExpensesFromKnownBackups = () => {
  const existing = readLocalExpenses()
  const recovered = []
  const sources = []
  const keys = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && knownExpenseBackupPrefixes.some(prefix => key.startsWith(prefix))) keys.push(key)
  }

  keys.sort()
  for (const key of keys) {
    const value = readJson(key, null)
    const rows = expenseRowsFromBackupValue(value)
    if (!rows.length) continue
    sources.push({ key, count: rows.length })
    for (const raw of rows) {
      const row = normalizeExpense(raw)
      if (!row.amount) continue
      const duplicate = [...existing, ...recovered].some(candidate => areExpenseDuplicates(candidate, row))
      if (!duplicate) recovered.push({ ...row, recoverySource: key })
    }
  }

  for (const row of recovered) saveLocalExpensePending(row)

  return {
    scannedBackups: keys.length,
    sources,
    recoveredCount: recovered.length,
    localCountBefore: existing.length,
    localCountAfter: readLocalExpenses().length,
  }
}

export const createFullRecoveryClickHandler = ({ getCurrentUser = () => centralAuth()?.currentUser, signIn = signInCentralWithGoogle, runRecovery = runFullRecoverySync, onStart, onSuccess, onError } = {}) => {
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
