export const toArabic = str => String(str).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d])

export const formatMoney = (value, showCurrency = true) => {
  const num = Number(value || 0)
  const formatted = toArabic(num.toLocaleString('en-US'))
  return showCurrency ? `${formatted} د.ع` : formatted
}

export const formatNumber = value => toArabic(Number(value || 0).toLocaleString('en-US'))

export const formatDate = (dateString, options) => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toArabic(dateString)
  return toArabic(date.toLocaleDateString('en-CA', options))
}

export const formatTime = (dateString, options) => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toArabic(dateString)
  return toArabic(date.toLocaleTimeString('en-US', options || { hour: '2-digit', minute: '2-digit', hour12: true }))
}

export const formatDateTime = dateString => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return toArabic(dateString)
  return toArabic(date.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
}
