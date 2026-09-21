const DEFAULT_URL = 'http://127.0.0.1:17821'

const jsonHeaders = token => ({
  'content-type': 'application/json',
  ...(token ? { 'X-101-Print-Token': token } : {}),
})

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'omit' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || `خدمة الطباعة أعادت HTTP ${response.status}.`), { status: response.status, body })
  return body
}

export const thermalServiceUrl = settings => String(settings?.serviceUrl || DEFAULT_URL).replace(/\/$/, '')

export async function checkThermalService(settings = {}) {
  return request(`${thermalServiceUrl(settings)}/health`, { headers: jsonHeaders(settings.token) })
}

export async function printThermalDocument({ settings, jobId, document }) {
  if (!settings?.directThermal) throw new Error('الطباعة الحرارية المباشرة غير مفعلة.')
  if (!jobId || !document?.kind) throw new Error('مستند طباعة أو jobId غير صالح.')
  return request(`${thermalServiceUrl(settings)}/print`, {
    method: 'POST',
    headers: jsonHeaders(settings.token),
    body: JSON.stringify({ jobId, document }),
  })
}

export const defaultThermalSettings = {
  serviceUrl: DEFAULT_URL,
  token: '',
  directThermal: false,
  serviceReady: false,
  printerVerified: false,
  paper: '80mm',
}
