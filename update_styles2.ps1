$content = Get-Content -Path src/styles.css -Raw
$content = $content -replace '\.del-btn \{.*?\}', '.del-btn { color: var(--danger); background: transparent; padding: 4px; border-radius: 4px; }
.edit-btn { color: var(--muted); background: transparent; padding: 4px; border-radius: 4px; }
.i-actions { display: flex; gap: 4px; justify-content: center; }'
$content = $content -replace '\.i-prod-img img \{', '.i-prod-img img { width: 32px; height: 32px; object-fit: cover; border-radius: 4px;'
Set-Content -Path src/styles.css -Value $content
