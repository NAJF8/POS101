$app = Get-Content -Path src/App.jsx -Raw
$app = $app -replace "setModal\('history'\)", "setModal('single-history')"
$app = $app -replace "modal === 'history' && <History", "modal === 'single-history' && <History"
$app = $app -replace "setModal\('single-history'\)
    }", "setModal('history')
    }"
Set-Content -Path src/App.jsx -Value $app
