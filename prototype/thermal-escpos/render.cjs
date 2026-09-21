const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = __dirname;
const out = path.join(root, 'out');
const logo = path.join(__dirname, '..', '..', 'public', 'assets', 'branding', '101-logo-transparent.png');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8'));
const { fakeSale, fakeReport } = require('./fixtures.cjs');

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(n) { return new Intl.NumberFormat('ar-IQ').format(n); }
function imageUri() { return `data:image/png;base64,${fs.readFileSync(logo).toString('base64')}`; }
function baseStyle() {
  return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{width:${profile.printableWidthDots}px;font-family:Tahoma,"Segoe UI",Arial,sans-serif;font-size:22px;font-weight:600;line-height:1.35}.sheet{width:${profile.printableWidthDots}px;padding:22px 24px 28px;direction:rtl}.logo{display:block;width:150px;height:150px;object-fit:contain;margin:0 auto 8px;filter:grayscale(1) brightness(0)}.brand{text-align:center;font-size:22px;font-weight:800;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:14px}.title{text-align:center;font-size:28px;font-weight:900;margin:8px 0 14px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;border-bottom:2px dashed #000;padding-bottom:12px;margin-bottom:14px}.meta b{font-weight:900}.row{display:grid;grid-template-columns:1fr 90px 130px;gap:8px;align-items:center;border-bottom:1px solid #000;padding:9px 0}.row.head{font-size:18px;font-weight:900;border-bottom:2px solid #000}.ltr{direction:ltr;text-align:left;white-space:nowrap}.total{font-size:29px;font-weight:900;border:3px solid #000;padding:12px;margin-top:16px;display:flex;justify-content:space-between}.footer{text-align:center;border-top:2px solid #000;margin-top:20px;padding-top:14px;font-size:19px;font-weight:800}.report-table .row{grid-template-columns:130px 110px 1fr 150px 130px;font-size:19px}.report-table .row.head{font-size:16px}.summary{margin-top:16px;font-size:26px;font-weight:900;border:3px solid #000;padding:10px;text-align:center}`;
}
function invoiceHtml(sale = fakeSale) {
  const items = sale.items || sale.order?.items || [];
  const rows = items.map((i, n) => `<div class="row"><span>${n + 1}. ${esc(i.name)}</span><span class="ltr">${i.quantity}</span><span class="ltr">${money(Number(i.price || 0) * Number(i.quantity || 0))}</span></div>`).join('');
  const total = Number(sale.total ?? items.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0));
  return `<!doctype html><style>${baseStyle()}</style><main class="sheet"><img class="logo" src="${imageUri()}"><div class="brand">101 COFFEE HOUSE</div><div class="title">فاتورة بيع</div><div class="meta"><span>رقم الطلب: <b class="ltr">${esc(sale.orderNumber || '')}</b></span><span>التاريخ: <b class="ltr">${esc(sale.createdAt || '')}</b></span><span>الكاشير: <b>${esc(sale.seller || sale.cashierNameSnapshot || '')}</b></span><span>الدفع: <b>${esc(sale.payment || (sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'))}</b></span></div><div class="row head"><span>المادة</span><span>الكمية</span><span>المجموع</span></div>${rows}<div class="total"><span>الإجمالي</span><span class="ltr">${money(total)} د.ع</span></div><div class="footer">شكراً لزيارتكم<br>@101co_ffee<br>GOOD COFFEE / GOOD PEOPLE / BETTER DAYS</div></main>`;
}
function reportHtml(report = fakeReport) {
  const sales = report.sales || [];
  const rows = sales.map((s, n) => `<div class="row"><span class="ltr">${esc(s.order || s.orderNumber || n + 1)}</span><span class="ltr">${esc(s.time || s.createdAt || '')}</span><span>${esc(s.cashier || s.seller || s.cashierNameSnapshot || '')}</span><span>${esc(s.method || (s.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'))}</span><span class="ltr">${money(s.total)}</span></div>`).join('');
  const total = Number(report.total ?? sales.reduce((sum, s) => sum + Number(s.total || 0), 0));
  return `<!doctype html><style>${baseStyle()}</style><main class="sheet"><img class="logo" src="${imageUri()}"><div class="brand">101 COFFEE HOUSE</div><div class="title">${esc(report.title || 'تقرير المبيعات')}</div><div class="meta"><span>الفترة: <b class="ltr">${esc(report.period || `${report.dateFrom || ''} - ${report.dateTo || ''}`)}</b></span><span>عدد العمليات: <b class="ltr">${sales.length}</b></span></div><section class="report-table"><div class="row head"><span>الطلب</span><span>الوقت</span><span>الكاشير</span><span>الدفع</span><span>الإجمالي</span></div>${rows || '<div class="row"><span>لا توجد مبيعات ضمن الفترة المحددة</span></div>'}</section><div class="summary">إجمالي التقرير: <span class="ltr">${money(total)} د.ع</span></div><div class="footer">@101co_ffee<br>GOOD COFFEE / GOOD PEOPLE / BETTER DAYS</div></main>`;
}

async function renderOne(browser, name, html) {
  const page = await browser.newPage();
  await page.setViewport({ width: profile.printableWidthDots, height: 1000, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const body = await page.$('.sheet');
  const box = await body.boundingBox();
  const png = path.join(out, `${name}.png`);
  await body.screenshot({ path: png });
  await page.close();
  return { name, png, widthDots: Math.round(box.width), heightDots: Math.round(box.height) };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const results = [await renderOne(browser, 'fixture-invoice', invoiceHtml()), await renderOne(browser, 'fixture-report', reportHtml())];
  await browser.close();
  fs.writeFileSync(path.join(out, 'render-results.json'), JSON.stringify({ profile, results }, null, 2));
  return results;
}

async function renderDocument(browser, document, name) {
  return renderOne(browser, document.kind === 'invoice' ? name : name, document.kind === 'invoice' ? invoiceHtml(document.sale) : reportHtml(document.report));
}

if (require.main === module) main().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e); process.exit(1); });
module.exports = { main, renderDocument };
