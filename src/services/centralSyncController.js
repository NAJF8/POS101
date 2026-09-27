import { getCentralRole } from './posCentralSync.js'

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
      const role = getCentralRole(user)

      if (role === 'admin-viewer') {
        const result = await runAdminRefresh()
        onSuccess?.({ role, result })
        return { role, result }
      }

      if (role === 'cashier-sync') {
        const result = await runCashierSync()
        onSuccess?.({ role, result })
        return { role, result }
      }

      throw Object.assign(new Error('هذا الحساب غير مخول للمزامنة.'), { code: 'CENTRAL_ROLE_BLOCKED' })
    } catch (error) {
      onError?.(error)
      return { error }
    } finally {
      busy = false
    }
  }
}
