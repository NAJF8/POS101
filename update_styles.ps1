$content = Get-Content -Path src/styles.css -Raw
$content = $content -replace 'grid-template-columns: 36px 70px 90px 70px 1fr 30px;', 'grid-template-columns: 24px 1fr 65px 75px 65px 50px;'
$content = $content -replace '\.i-prod \{.*?\}', '.i-prod { display: flex; align-items: center; gap: 6px; }'
Set-Content -Path src/styles.css -Value $content
