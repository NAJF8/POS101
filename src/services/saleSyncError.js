const lower = value => String(value || '').toLowerCase()

const ERROR_MESSAGES = Object.freeze({
  NETWORK_OFFLINE: 'الاتصال بالإنترنت مقطوع.',
  FIREBASE_DISCONNECTED: 'تعذر الاتصال بقاعدة البيانات.',
  AUTH_MISSING: 'جلسة الكاشير غير جاهزة. أعد تحميل الصفحة أو فعّل الجهاز.',
  AUTH_EXPIRED: 'انتهت جلسة الكاشير. أعد تحميل الصفحة ثم حاول مرة أخرى.',
  PERMISSION_DENIED: 'صلاحية الكاشير لا تسمح بإرسال الطلب.',
  WRITE_TIMEOUT: 'تأخر إرسال الطلب. اضغط إعادة المحاولة مرة واحدة.',
  READBACK_TIMEOUT: 'تم إرسال الطلب لكن لم يتم تأكيده. اضغط إعادة المحاولة مرة واحدة.',
  PAYLOAD_INVALID: 'تعذر تجهيز الطلب، تحقق من عناصر السلة.',
  ORDER_NUMBER_FAILED: 'تعذر تخصيص رقم الطلب. بقي الطلب في السلة.',
  QUOTA_LOCAL_CACHE: 'تم تثبيت الطلب مركزيًا، لكن تعذر تحديث الكاش المحلي.',
  STALE_QUEUE_QUARANTINED: 'تم عزل عناصر مزامنة قديمة ويمكن للإدارة مراجعتها.',
  UNKNOWN: 'فشل إرسال الطلب. لم يتم حذف الطلب من السلة.',
})

const result = (errorClass, legacyKind) => ({
  errorClass,
  kind: legacyKind,
  message: ERROR_MESSAGES[errorClass] || ERROR_MESSAGES.UNKNOWN,
  messageAr: ERROR_MESSAGES[errorClass] || ERROR_MESSAGES.UNKNOWN,
  errorMessageAr: ERROR_MESSAGES[errorClass] || ERROR_MESSAGES.UNKNOWN,
})

export const SALE_ERROR_MESSAGES = ERROR_MESSAGES

export const classifySaleSyncError = (error, { online = typeof navigator === 'undefined' || navigator.onLine !== false } = {}) => {
  const code = lower(error?.code)
  const message = lower(error?.message || error)
  if (!online || ['network_error', 'network_request_failed', 'failed_to_fetch', 'offline'].includes(code) || /network|offline|fetch failed/.test(message)) return result('NETWORK_OFFLINE', 'network')
  if (['firebase_disconnected', 'database_disconnected', 'disconnected', 'unavailable'].includes(code) || /firebase.*disconnect|database.*disconnect|disconnected/.test(message)) return result('FIREBASE_DISCONNECTED', 'firebase')
  if (['auth_required', 'unauthenticated', 'kiosk_auth_required', 'kiosk_activation_required', 'not_configured'].includes(code)) return result('AUTH_MISSING', 'auth')
  if (['auth_expired', 'id_token_expired', 'token_expired'].includes(code) || /token.*expired|session.*expired/.test(message)) return result('AUTH_EXPIRED', 'auth')
  if (['permission_denied', 'central_role_blocked', 'permission-denied'].includes(code) || /permission denied|ليس لديه صلاحية|صلاحية الكاشير/.test(message)) return result('PERMISSION_DENIED', 'permission')
  if (['readback_timeout', 'sale_readback_timeout'].includes(code)) return result('READBACK_TIMEOUT', 'readback')
  if (['sale_readback_failed', 'order_number_readback_failed', 'sale_readback_mismatch'].includes(code) || /read.?back|تأكيد.*مركزي/.test(message)) return result('READBACK_TIMEOUT', 'readback')
  if (['write_timeout', 'timeout', 'deadline_exceeded', 'sync_process_timeout'].includes(code) || /write.*timeout|timed out|timeout|تأخر/.test(message)) return result('WRITE_TIMEOUT', 'timeout')
  if (['sale_payload_incomplete', 'payload_invalid', 'invalid_cart'].includes(code) || /بيانات البيع المركزية غير مكتملة|تعذر تجهيز الطلب/.test(message)) return result('PAYLOAD_INVALID', 'payload')
  if (['order_number_failed', 'order_number_transaction_failed', 'order_number_day_required', 'central_day_mismatch'].includes(code) || /تخصيص رقم الطلب|اليوم التشغيلي/.test(message)) return result('ORDER_NUMBER_FAILED', 'order')
  if (['quota_local_cache', 'quotaexceedederror', 'storage_quota'].includes(code) || /quota|storage.*full|exceeded the quota/.test(message)) return result('QUOTA_LOCAL_CACHE', 'quota')
  if (['stale_queue_quarantined', 'queue_quarantined'].includes(code)) return result('STALE_QUEUE_QUARANTINED', 'queue')
  return result('UNKNOWN', 'unknown')
}

export const isRetryableSaleError = errorClass => !new Set(['PAYLOAD_INVALID', 'TRUE_DUPLICATE', 'SALE_ID_COLLISION', 'OPERATION_KEY_COLLISION']).has(String(errorClass || ''))
