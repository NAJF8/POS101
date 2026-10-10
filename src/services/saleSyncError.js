const text = value => String(value || '').toLowerCase()

export const classifySaleSyncError = (error, { online = typeof navigator === 'undefined' || navigator.onLine !== false } = {}) => {
  const code = text(error?.code)
  const message = text(error?.message || error)
  if (!online || ['network_error', 'network_request_failed', 'failed_to_fetch', 'unavailable'].includes(code) || /network|offline|disconnected|fetch failed|connection/.test(message)) {
    return { kind: 'network', message: 'الاتصال بالإنترنت مقطوع. لم يتم إرسال الطلب.' }
  }
  if (['auth_required', 'unauthenticated', 'kiosk_auth_required', 'kiosk_activation_required', 'central_role_blocked'].includes(code)) {
    return { kind: 'auth', message: 'جلسة الكاشير غير جاهزة. أعد تحميل الصفحة أو فعّل الجهاز.' }
  }
  if (code === 'permission_denied' || /permission denied|ليس لديه صلاحية|صلاحية/.test(message)) {
    return { kind: 'permission', message: 'صلاحية الكاشير لا تسمح بإرسال الطلب. راجع إعدادات Firebase.' }
  }
  if (['sale_readback_failed', 'order_number_readback_failed'].includes(code) || /read.?back|تأكيد.*مركزي/.test(message)) {
    return { kind: 'readback', message: 'تعذر تأكيد الطلب مركزيًا. لا تعِد البيع قبل الفحص.' }
  }
  if (code.includes('timeout') || code === 'deadline_exceeded' || /timeout|timed out|تأخر/.test(message)) {
    return { kind: 'timeout', message: 'تأخر إرسال الطلب. حاول مرة أخرى.' }
  }
  return { kind: 'unknown', message: 'فشل إرسال الطلب. تحقق من الاتصال ثم اضغط إعادة المحاولة.' }
}
