$content = Get-Content -Path src/components/OrderHistoryMenu.jsx -Raw
$content = $content -replace 'const deleteSale = \(sale\) => \{.*?\n.*?\}', "const deleteSale = (sale) => {
    if (window.confirm('?? ??? ????? ?? ?????/????? ??? ??????')) {
      const newSales = sales.map(s => s.id === sale.id ? { ...s, status: 'voided' } : s)
      localStorage.setItem('pos101.sales', JSON.stringify(newSales))
      setSales(newSales)
    }
  }"
Set-Content -Path src/components/OrderHistoryMenu.jsx -Value $content
