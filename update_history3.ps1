$content = Get-Content -Path src/components/OrderHistoryMenu.jsx -Raw
$content = $content -replace 'const \[method, setMethod\] = useState\(''????''\)', "const [method, setMethod] = useState('????')
  const [status, setStatus] = useState('????')"
$content = $content -replace 'const matchesMethod = method === ''????'' \|\| \(method === ''????'' && s\.paymentMethod === ''cash''\) \|\| \(method === ''????????'' && s\.paymentMethod === ''card''\)', "const matchesMethod = method === '????' || (method === '????' && s.paymentMethod === 'cash') || (method === '????????' && s.paymentMethod === 'card')
      const matchesStatus = status === '????' || (status === '????' && s.status === 'voided') || (status === '?????' && s.status !== 'voided')"
$content = $content -replace 'return matchesQuery && matchesMethod', 'return matchesQuery && matchesMethod && matchesStatus'
$content = $content -replace '<select value=\{method\} onChange=\{e => \{setMethod\(e\.target\.value\); setPage\(1\)\}\}>.*?</select>', "<select value={method} onChange={e => {setMethod(e.target.value); setPage(1)}}>
            <option value="????">???? ???????</option>
            <option value="????">????</option>
            <option value="????????">????????</option>
          </select>
          <select value={status} onChange={e => {setStatus(e.target.value); setPage(1)}}>
            <option value="????">???? ???????</option>
            <option value="?????">?????</option>
            <option value="????">????</option>
          </select>"
Set-Content -Path src/components/OrderHistoryMenu.jsx -Value $content
