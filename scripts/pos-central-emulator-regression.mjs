import assert from 'node:assert/strict'

const base = process.env.POS101_EMULATOR_DATABASE_URL || 'http://127.0.0.1:9000'
const namespace = process.env.POS101_EMULATOR_NAMESPACE || 'demo-no-project-default-rtdb'
const request = async (path, { method = 'GET', body, auth } = {}) => {
  const params = new URLSearchParams({ ns: namespace })
  if (auth) params.set('auth_variable_override', JSON.stringify(auth))
  else if (method !== 'GET') params.set('access_token', 'owner')
  const response = await fetch(`${base}/${path}.json?${params}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  let value = null
  try { value = await response.json() } catch {}
  return { response, value }
}
const kioskAuth = kioskId => ({ uid: `pos101-${kioskId}`, token: { pos101_kiosk: true, scope: 'cashier', kioskId } })
const countSales = value => Object.values(value || {}).filter(row => row?.saleId).length

const kioskId = `emulator-kiosk-${Date.now()}`
const kiosk = { kioskId, uid: `pos101-${kioskId}`, active: true, scope: 'cashier' }
let result = await request(`pos101_kiosks/${kioskId}`, { method: 'PUT', body: kiosk })
assert.equal(result.response.status, 200)

const sales = Object.fromEntries(Array.from({ length: 70 }, (_, index) => {
  const saleId = `emulator-sale-${index + 1}`
  return [saleId, { saleId, operationKey: `pos101:${saleId}`, businessDate: '2026-10-07', operationalDayId: 'emulator-day', total: 5000, items: [{ id: 'fixture', quantity: 1, price: 5000 }] }]
}))
const authorized = kioskAuth(kioskId)
result = await request('pos101_sales', { method: 'PUT', body: sales, auth: authorized })
assert.equal(result.response.status, 200)
result = await request('pos101_sales', { auth: authorized })
assert.equal(result.response.status, 200)
assert.equal(countSales(result.value), 70)
result = await request('pos101_sales')
assert.ok(result.response.status >= 400 || result.value === null)

result = await request(`pos101_kiosks/${kioskId}/active`, { method: 'PUT', body: false })
assert.equal(result.response.status, 200)
result = await request('pos101_sales', { auth: authorized })
assert.ok(result.response.status >= 400 || result.value === null)

console.log(JSON.stringify({
  FIREBASE_EMULATOR: 'PASS',
  KIOSK_AUTHORIZED_READ_WRITE: 'PASS',
  ANONYMOUS_BLOCKED: 'PASS',
  REVOKED_KIOSK_BLOCKED: 'PASS',
  CENTRAL_UNIQUE_SALES: 70,
  PRODUCTION_WRITES: 'NO',
}, null, 2))
