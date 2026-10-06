const text = value => String(value ?? '').trim()
const canonical = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')

export const isHaydarStaff = person => canonical(person?.name) === 'حيدر' && text(person?.code) === '109'

// Missing canSell is intentionally treated as true for legacy staff records.
// Haydar is the explicit non-seller exception requested by the business flow.
export const staffCanSell = person => !isHaydarStaff(person) && person?.canSell !== false

export const normalizeStaffCanSell = person => (isHaydarStaff(person) ? false : person?.canSell !== false)

export const sellerEligibleStaff = (staff = []) => (Array.isArray(staff) ? staff : []).filter(person => person?.active !== false && staffCanSell(person))
