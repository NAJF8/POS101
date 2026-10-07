export const day = (id, businessDate, status = 'closed') => ({ id, operationalDayId: id, businessDate, status })

export const sale = ({ id, dayId, businessDate, total, paymentMethod = 'cash', subtotal = total, discount = subtotal - total, status = '', createdAt = 0, operationKey = '' }) => ({
  id, saleId: id, operationKey, operationalDayId: dayId, businessDate, subtotal, discount, total, paymentMethod, status, createdAt, items: [{ name: 'fixture', quantity: 1 }],
})

export const expense = ({ id, dayId, businessDate, amount, category = 'مشتريات', status = 'disabled' }) => ({ id, operationalDayId: dayId, businessDate, amount, category, status })

export const transaction = ({ id, dayId, businessDate, type, amount, status = 'active' }) => ({ id, operationalDayId: dayId, businessDate, type, amount, status })

export const fixtureDays = {
  matched: day('day-1', '2026-10-01'), shortage: day('day-2', '2026-10-02'), discount: day('day-3', '2026-10-03'),
  salaryWithdrawal: day('day-4', '2026-10-04'), offline: day('day-5', '2026-10-05'), voided: day('day-6', '2026-10-06'),
  staleCache: day('day-7', '2026-10-07'), electronicOnly: day('day-8', '2026-10-08'), midnight: day('day-9', '2026-10-09'),
  historicalAfterOpen: day('day-10', '2026-10-10'),
}
