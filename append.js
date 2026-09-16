const fs = require('fs');
const cssToAppend = \
.edit-btn { color: var(--muted); background: transparent; padding: 4px; border-radius: 4px; }
.i-actions { display: flex; gap: 4px; justify-content: center; }
.pos-body { position: relative; }
.history-modal-overlay {
  position: absolute;
  top: 16px; bottom: 16px; right: 16px;
  left: calc(var(--cart-w) + 32px);
  background: rgba(0,0,0,0.5);
  border-radius: var(--r-lg);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.history-modal-content {
  background: #fff;
  width: 100%;
  height: 100%;
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  direction: rtl;
  overflow: hidden;
}
.history-header {
  padding: 20px;
  text-align: center;
  border-bottom: 1px solid var(--line);
}
.history-header h2 { margin: 0; font-size: 24px; color: var(--coffee); display: flex; justify-content: center; align-items: center; gap: 10px; }
.history-header p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.close-btn {
  position: absolute; top: 16px; left: 16px;
  background: transparent; color: var(--muted); padding: 8px; border-radius: 8px;
}
.close-btn:hover { background: var(--line); }

.history-filters {
  padding: 16px 20px;
  display: flex;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  background: var(--cream);
}
.search-box {
  flex: 1;
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid var(--line-strong); border-radius: 8px; padding: 0 12px;
}
.search-box input { flex: 1; height: 40px; background: transparent; }
.history-filters select {
  height: 40px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 8px; background: #fff;
}

.history-table-wrapper {
  flex: 1; overflow-y: auto; padding: 0; background: #fff;
}
.history-table {
  width: 100%; border-collapse: collapse; text-align: right;
}
.history-table th {
  position: sticky; top: 0; background: #f0eee8; padding: 12px 16px; font-weight: 700; color: var(--coffee); border-bottom: 1px solid var(--line-strong);
}
.history-table td {
  padding: 12px 16px; border-bottom: 1px solid var(--line); color: var(--coffee);
}
.h-actions { display: flex; gap: 8px; justify-content: flex-start; }
.h-actions button {
  background: #f0eee8; color: var(--coffee); padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
}
.h-actions button:hover { background: #e4dfd6; }
.h-actions button.del { color: var(--danger); }
.h-actions button.del:hover { background: var(--danger-bg); }

.history-footer {
  padding: 16px 20px; border-top: 1px solid var(--line); background: var(--cream);
  display: flex; justify-content: space-between; align-items: center;
}
.pagination { display: flex; align-items: center; gap: 16px; }
.pagination button { background: #fff; border: 1px solid var(--line-strong); padding: 6px 12px; border-radius: 6px; }
.pagination button:disabled { opacity: 0.5; }
.history-count { font-weight: 600; color: var(--muted); }
\;
fs.appendFileSync('src/styles.css', cssToAppend, 'utf8');
