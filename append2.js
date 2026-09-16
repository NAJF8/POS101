const fs = require('fs');
const cssToAppend = \
.discount-row { margin-bottom: 12px; }
.discount-btn {
  display: flex; align-items: center; justify-content: space-between;
  width: auto; padding: 6px 12px 6px 6px; border-radius: 20px;
  border: 1px solid var(--green); background: #eef2eb; color: var(--green);
}
.discount-icon-circle {
  width: 24px; height: 24px; background: var(--green); color: #fff;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: bold; margin-left: 8px;
}
.down-chevron { transform: rotate(90deg); margin-right: 8px; }
\;
fs.appendFileSync('src/styles.css', cssToAppend, 'utf8');
