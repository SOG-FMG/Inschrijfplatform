# Cloudflare-plugin installeren voor Claude Code (VS Code-extensie)
$ErrorActionPreference = 'Stop'

# 1. Nieuwste bundled claude.exe zoeken
$claude = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter 'anthropic.claude-code-*' |
    Sort-Object { [version](($_.Name -replace '^anthropic\.claude-code-','') -replace '-win32-x64$','') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'resources\native-binary\claude.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $claude) { throw 'claude.exe niet gevonden.' }
Write-Host "Gebruik: $claude"

# 2. Restanten van de mislukte poging opruimen
$mp = "$env:USERPROFILE\.claude\plugins\marketplaces"
Get-ChildItem $mp -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object Name -like 'cloudflare-skills*' |
    ForEach-Object { Write-Host "Verwijder $($_.FullName)"; Remove-Item $_.FullName -Recurse -Force }

# 3. Marketplace toevoegen via HTTPS (geen SSH), met herkansingen
$ok = $false
for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    Write-Host "Poging ${i}: marketplace toevoegen..."
    & $claude plugin marketplace add 'https://github.com/cloudflare/skills.git'
    if ($LASTEXITCODE -eq 0) { $ok = $true } else { Start-Sleep -Seconds 5 }
}
if (-not $ok) { throw 'Marketplace toevoegen mislukt (zie EPERM-tips hieronder).' }

# 4. Plugin installeren
& $claude plugin install cloudflare@cloudflare
if ($LASTEXITCODE -ne 0) { throw 'Plugin installeren mislukt.' }
Write-Host 'Klaar. Herstart VS Code (of het Claude-paneel) om de plugin te laden.' -ForegroundColor Green
