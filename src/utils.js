const LATN_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { numberingSystem: 'latn' })
const LATN_DATETIME_FORMAT = new Intl.DateTimeFormat('en-GB', { numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export const toEnglishDigits = value => String(value).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))

export const formatNumber = value => LATN_NUMBER_FORMAT.format(Number(value || 0))

export const formatCurrency = (value, showCurrency = true) => {
  const formatted = formatNumber(value)
  return showCurrency ? `${formatted} د.ع` : formatted
}

export const formatMoney = formatCurrency

export const formatDate = (dateString, options) => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toEnglishDigits(dateString)
  return new Intl.DateTimeFormat('en-CA', { numberingSystem: 'latn', ...options }).format(date)
}

export const formatTime = (dateString, options) => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toEnglishDigits(dateString)
  return new Intl.DateTimeFormat('en-US', { numberingSystem: 'latn', ...(options || { hour: '2-digit', minute: '2-digit', hour12: true }) }).format(date)
}

export const formatDateTime = dateString => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toEnglishDigits(dateString)
  return LATN_DATETIME_FORMAT.format(date)
}
