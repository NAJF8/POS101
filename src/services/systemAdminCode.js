const SYSTEM_ADMIN_CODE = '0224'

export const verifySystemAdminCode = value => String(value || '') === SYSTEM_ADMIN_CODE
