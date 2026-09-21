const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const { main, renderDocument } = require('./render.cjs');
const root = __dirname;
const out = path.join(root, 'out');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8'));
const enabled = process.env.THERMAL_ESC_POS_ENABLE === '1';
const printer = process.env.THERMAL_ESC_POS_PRINTER || '';
const token = process.env.THERMAL_ESC_POS_TOKEN || '';
const allowedOrigins = new Set((process.env.THERMAL_ESC_POS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174').split(',').map(v => v.trim()).filter(Boolean));
const completed = new Map();
const completedFile = path.join(out, 'completed-jobs.json');
try { for (const [jobId, result] of Object.entries(JSON.parse(fs.readFileSync(completedFile, 'utf8')))) completed.set(jobId, result); } catch {}

function headers(res, req) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-101-print-token');
}
function json(res, req, status, value) { headers(res, req); res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); }
function auth(req) {
  if (enabled && !token) return req.method === 'GET' && req.url === '/health';
  return !token || req.headers['x-101-print-token'] === token;
}
function readBody(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 512 * 1024) req.destroy(new Error('request too large')); }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('invalid JSON')); } }); req.on('error', reject); }); }
function printerStatus() {
  if (!printer) return { present: false, name: '' };
  const p = spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'printer-check.ps1'),'-PrinterName',printer], { encoding:'utf8' });
  if (p.status !== 0) return { present: false, name: printer };
  try { return JSON.parse(p.stdout.trim().split(/\r?\n/).pop()); } catch { return { present: false, name: printer }; }
}
function runRasterize(item) {
  const p = spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'rasterize.ps1'),'-PngPath',item.png,'-EscPosPath',path.join(out,`${item.name}.bin`),'-TargetWidthDots',String(profile.printableWidthDots),'-FeedLines',String(profile.feedLinesBeforeCut)], { encoding:'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout || 'rasterizer failed');
  return JSON.parse(p.stdout.trim().split(/\r?\n/).pop());
}
function sendRaw(item) {
  const p = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'winspool.ps1'),'-PrinterName',printer,'-PayloadPath',path.join(out,`${item.name}.bin`)],{encoding:'utf8'});
  if (p.status !== 0) throw new Error(p.stderr || p.stdout || 'WinSpool send failed');
  return JSON.parse(p.stdout.trim().split(/\r?\n/).pop());
}
async function printDocument(document, jobId) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const rendered = await renderDocument(browser, document, `job-${jobId.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    const item = { ...rendered, raster: runRasterize(rendered) };
    if (enabled) item.transport = sendRaw(item);
    return { mode: enabled ? 'hardware-enabled' : 'dry-run', profile, payload: item };
  } finally { await browser.close(); }
}
function health() {
  const printerInfo = enabled ? printerStatus() : { present: false, name: null };
  return { ok: true, mode: enabled ? 'hardware-enabled' : 'dry-run', loopbackOnly: true, tokenRequired: enabled || Boolean(token), printer: enabled ? printer : null, printerPresent: printerInfo.present, profile, ready: enabled && Boolean(token) && printerInfo.present && profile.verified };
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { headers(res, req); res.writeHead(204); return res.end(); }
  if (!auth(req)) return json(res, req, 401, { ok:false, error:'invalid print token' });
  if (req.method === 'GET' && req.url === '/health') return json(res, req, 200, health());
  if (req.method === 'POST' && req.url === '/render-fixtures') { try { const results = await main(); return json(res, req, 200, { mode:'dry-run', profile, payloads: results.map(item => ({ ...item, raster: runRasterize(item) })) }); } catch (e) { return json(res, req, 500, {ok:false, error:e.message}); } }
  if (req.method === 'POST' && req.url === '/print') {
    try {
      const body = await readBody(req); const jobId = String(body.jobId || ''); const document = body.document;
      if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(jobId) || !document || !['invoice','report'].includes(document.kind)) return json(res, req, 400, {ok:false, error:'invalid jobId or document'});
      if (completed.has(jobId)) return json(res, req, 200, {ok:true, duplicate:true, jobId, ...completed.get(jobId)});
      if (enabled && (!printer || !health().ready)) return json(res, req, 409, {ok:false, error:'printer is not verified and ready'});
      const result = await printDocument(document, jobId); completed.set(jobId, result); while (completed.size > 200) completed.delete(completed.keys().next().value);
      fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(completedFile, JSON.stringify(Object.fromEntries(completed), null, 2));
      return json(res, req, 200, {ok:true, duplicate:false, jobId, ...result});
    } catch (e) { return json(res, req, 500, {ok:false, error:e.message}); }
  }
  return json(res, req, 404, {ok:false,error:'not found'});
});
if (require.main === module) server.listen(17821, '127.0.0.1', () => console.log('thermal prototype listening on http://127.0.0.1:17821'));
module.exports = { server, health };
