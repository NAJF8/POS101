$content = Get-Content -Path src/components/OrderHistoryMenu.jsx -Raw
$content = $content -replace '<tr key=\{s\.id\}>', '<tr key={s.id} style={{ opacity: s.status === ''voided'' ? 0.5 : 1 }}>'
$content = $content -replace '<td>\{s\.total\?\.toLocaleString\(\)\} ?\.?</td>', '<td>{s.total?.toLocaleString()} ?.? {s.status === ''voided'' && <span style={{color: ''red'', fontSize: ''10px''}}>(????)</span>}</td>'
Set-Content -Path src/components/OrderHistoryMenu.jsx -Value $content
