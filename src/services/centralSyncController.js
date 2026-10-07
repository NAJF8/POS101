import { canSyncPosSales } from './posCentralSync.js'

// The Header and the Admin read-only panel both use this one controller. Role
// resolution happens before either role-specific operation can run.
export const createCentralSyncClickHandler = ({
  getCurrentUser,
  signIn,
  runAdminRefresh,
  runCashierSync,
  onStart,
  onSuccess,
  onError,
}) => {
  let busy = false

  return async function handleCentralSyncClick() {
    if (busy) return { skipped: true }
    busy = true
    onStart?.()
    try {
      const user = getCurrentUser() || await signIn()
      const permission = await canSyncPosSales(user)
      if (!permission.allowed) throw Object.assign(new Error(`هذا الحساب غير مخول للمزامنة: ${permission.missingReason}`), { code: 'CENTRAL_ROLE_BLOCKED', permission })
      const result = await runCashierSync()
      const role = 'pos-sync'
      onSuccess?.({ role, result })
      return { role, result }
    } catch (error) {
      onError?.(error)
      return { error }
    } finally {
      busy = false
    }
  }
}
