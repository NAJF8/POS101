import { getLocalDateKey, normalizeDateKey } from './expenseReporting.js'

export const businessDateOf = row => normalizeDateKey(row?.businessDate || row?.business_date || row?.shiftBusinessDate) || getLocalDateKey(row?.createdAt || row?.created_at || row?.date || row?.timestamp)
export const isValidDateRange = (from, to) => Boolean(from && to && normalizeDateKey(from) && normalizeDateKey(to) && from <= to)
export const filterRowsByBusinessDate = (rows = [], from, to) => {
  if (!isValidDateRange(from, to)) return []
  return (Array.isArray(rows) ? rows : []).filter(row => { const date = businessDateOf(row); return date >= from && date <= to })
}
