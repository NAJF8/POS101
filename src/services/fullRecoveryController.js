import { centralAuth, isAuthorizedPosSyncUser, runFullRecoverySync, signInCentralWithGoogle } from './posCentralSync.js'

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
