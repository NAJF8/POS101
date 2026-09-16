const fs = require('fs');
let css = fs.readFileSync('src/styles.css', 'utf8');

function removeMediaPrint(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let idx = text.indexOf('@media print', i);
    if (idx === -1) {
      out += text.substring(i);
      break;
    }
    out += text.substring(i, idx);
    let openBraces = 0;
    let started = false;
    let j = idx;
    while (j < text.length) {
      if (text[j] === '{') { openBraces++; started = true; }
      else if (text[j] === '}') { openBraces--; }
      j++;
      if (started && openBraces === 0) break;
    }
    i = j;
  }
  return out;
}

let newCss = removeMediaPrint(css);

const basePrintStyles = `
@media print {
  /* Hide UI elements globally */
  .app-header, .non-printable, .dashboard-container, .reports-sidebar, .pos-header, .cart-panel, .catalog-panel, .history-sidebar {
    display: none !important;
  }
  
  /* Reset body */
  html, body {
    background: #fff !important;
    height: auto !important;
    overflow: visible !important;
  }

  /* Receipt base */
  body .receipt-sheet {
    display: block !important;
    position: static !important;
    width: 80mm;
    margin: 0;
    padding: 4mm 4mm 8mm;
    background: #fff;
    color: #111;
    font-family: 'IBM Plex Sans Arabic', Tahoma, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
  }
  body .receipt-logo-wrap { margin: 0 0 3mm; text-align: center; }
  body .receipt-logo { display: inline-block; width: 34mm; max-height: 20mm; object-fit: contain; }
  body .receipt-date { margin: 0 0 3mm; text-align: center; font-size: 9pt; }
  body .receipt-items { border: .25mm solid #222; border-radius: 0; }
  body .receipt-table-head, body .receipt-line { display: grid !important; grid-template-columns: minmax(0, 1fr) 12mm 20mm; gap: 2mm; align-items: start; }
  body .receipt-table-head { padding: 2mm; border-bottom: .25mm solid #222; font-size: 8pt; font-weight: 700; }
  body .receipt-line { margin: 0; padding: 2mm; border-bottom: .2mm solid #bbb; }
  body .receipt-line:last-child { border-bottom: 0; }
  body .receipt-total { display: grid !important; grid-template-columns: minmax(0, 1fr) auto; gap: 4mm; margin: 4mm 0 0; padding: 3mm 1mm 0; border-top: .45mm solid #111; font-weight: 700; font-size: 12pt; }

  /* Reports base */
  .report-paper {
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  
  /* Dialogs that should print */
  .dialog-overlay, .dialog {
    position: static !important;
    background: #fff !important;
    box-shadow: none !important;
    inset: auto !important;
    padding: 0 !important;
    transform: none !important;
    width: 100% !important;
    height: auto !important;
    max-width: none !important;
    max-height: none !important;
  }
}
`;

newCss += '\n' + basePrintStyles;
fs.writeFileSync('src/styles.css', newCss);
console.log('Fixed styles.css');
