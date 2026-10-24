# Installaties van het platform beheren (een installatie = een organisatie, zie Plan_Modulair_Platform.md).
#
# Gebruik (in de terminal van VS Code, in de map van de repository):
#     .\installaties.ps1 lijst                 toont de installaties uit backend\wrangler.toml
#     .\installaties.ps1 nieuw <naam>          maakt D1 en R2 aan voor een nieuwe installatie
#     .\installaties.ps1 geheimen <naam>       zet ENCRYPTION_KEY en HOOFDADMIN_SETUP_CODE (eenmalig, na de eerste deploy)
#     .\installaties.ps1 deploy <naam>         migreert en deployt een installatie (backend en frontend)
#     .\installaties.ps1 deploy alle           eerst test, dan de andere, productie (FMG) als laatste
#
# "productie" is de installatie van FMG (de waarden bovenaan wrangler.toml, zonder --env).
# Een push naar main deployt productie ook automatisch (Workers Builds), maar voert GEEN migraties uit.
# Bevat een versie een migratie? Gebruik dan dit script, of voer de migratie uit voor je pusht.
#
# Opmerking: dit bestand bevat bewust geen accenten, zodat het in elke PowerShell werkt.

param(
    [Parameter(Position = 0)][string]$Opdracht = 'lijst',
    [Parameter(Position = 1)][string]$Naam = ''
)

$ErrorActionPreference = 'Stop'
$Basis = Join-Path $PSScriptRoot 'inschrijvingsplatform'
$Backend = Join-Path $Basis 'backend'
$Frontend = Join-Path $Basis 'frontend'

function Toon-Kop($tekst) { Write-Host ''; Write-Host "== $tekst ==" -ForegroundColor Cyan }
function Toon-Ok($tekst) { Write-Host "OK  $tekst" -ForegroundColor Green }
function Toon-Let-Op($tekst) { Write-Host "!   $tekst" -ForegroundColor Yellow }
function Stop-Hier($tekst) { Write-Host "X   $tekst" -ForegroundColor Red; exit 1 }

function Vraag-JaNee($vraag) {
    $a = ([string](Read-Host "$vraag [j/N]")).Trim().ToLower()
    return $a -in @('j', 'ja', 'y', 'yes')
}

# Installaties = productie + elke [env.<naam>] in backend\wrangler.toml.
function Installaties {
    $toml = Get-Content -LiteralPath (Join-Path $Backend 'wrangler.toml')
    $envs = @($toml | ForEach-Object { if ($_ -match '^\[env\.([a-z0-9-]+)\]\s*$') { $Matches[1] } })
    return @('productie') + $envs
}

# Voert een commando uit in een map; stopt bij een fout.
function Voer-Uit($map, $commando) {
    Write-Host "-> $commando" -ForegroundColor DarkGray
    Push-Location -LiteralPath $map
    try {
        & cmd.exe /c $commando
        if ($LASTEXITCODE -ne 0) { Stop-Hier "Mislukt: $commando (foutcode $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}

function EnvVlag($naam) { if ($naam -eq 'productie') { return '' } else { return " --env $naam" } }

function Controleer-Naam($naam) {
    if (-not $naam) { Stop-Hier 'Geef een naam op, bv.: .\installaties.ps1 deploy test' }
    if ($naam -notin (Installaties)) { Stop-Hier "Onbekende installatie '$naam'. Bekend: $((Installaties) -join ', '). Voeg ze eerst toe in backend\wrangler.toml (sjabloon onderaan)." }
    if ($naam -eq 'productie') { return }
    # Het blok van deze installatie: van [env.<naam>] tot de volgende andere installatie.
    $toml = Get-Content -Raw -LiteralPath (Join-Path $Backend 'wrangler.toml')
    $blok = (($toml -split "\[env\.$naam\]", 2)[1] -split "\n\[env\.(?!$naam[.\]])", 2)[0]
    if ($blok -match 'VUL-IN-NA-AANMAKEN') { Stop-Hier "In wrangler.toml staat voor '$naam' nog geen database_id. Voer eerst uit: .\installaties.ps1 nieuw $naam" }
}

function Deploy($naam) {
    Toon-Kop "Deploy: $naam"
    $vlag = EnvVlag $naam
    Voer-Uit $Backend 'node tools/migraties.mjs --controleer'
    Voer-Uit $Backend "npx wrangler d1 migrations apply DB --remote$vlag"
    Voer-Uit $Backend "npx wrangler deploy$vlag"
    Voer-Uit $Frontend 'npm run build'
    Voer-Uit $Frontend "npx wrangler deploy$vlag"
    Toon-Ok "$naam is bijgewerkt."
}

switch ($Opdracht) {
    'lijst' {
        Toon-Kop 'Installaties'
        Installaties | ForEach-Object { Write-Host "  $_" }
    }

    'nieuw' {
        if (-not $Naam -or $Naam -eq 'productie' -or $Naam -notmatch '^[a-z0-9-]+$') { Stop-Hier 'Geef een naam in kleine letters, bv.: .\installaties.ps1 nieuw meulestede' }
        Toon-Kop "Nieuwe installatie: $Naam"
        Write-Host "Dit maakt in je Cloudflare-account aan: D1-database inschrijvingen-db-$Naam (jurisdictie EU) en R2-bucket inschrijvingen-bestanden-$Naam (EU)."
        if (-not (Vraag-JaNee 'Doorgaan?')) { exit 0 }
        Voer-Uit $Backend "npx wrangler d1 create inschrijvingen-db-$Naam --jurisdiction eu"
        Voer-Uit $Backend "npx wrangler r2 bucket create inschrijvingen-bestanden-$Naam --jurisdiction eu"
        Write-Host ''
        Toon-Let-Op 'Nog te doen:'
        Write-Host "  1. backend\wrangler.toml: kopieer het sjabloon onderaan als [env.$Naam] (of gebruik [env.test]) en zet het database_id van hierboven in de plaats van VUL-IN-NA-AANMAKEN."
        Write-Host "  2. frontend\wrangler.jsonc: voeg onder `"env`" een blok `"$Naam`" toe met service inschrijvingsplatform-api-$Naam."
        Write-Host "  3. .\installaties.ps1 deploy $Naam"
        Write-Host "  4. .\installaties.ps1 geheimen $Naam"
        Write-Host "  5. Zet ALLOWED_ORIGINS en PUBLIC_APP_URL op de URL van de frontend-Worker en deploy opnieuw."
    }

    'geheimen' {
        Controleer-Naam $Naam
        Toon-Kop "Geheimen: $Naam"
        Toon-Let-Op 'ENCRYPTION_KEY versleutelt alle persoonsgegevens. Kwijt = gegevens onleesbaar. Overschrijven maakt bestaande gegevens onleesbaar.'
        if (-not (Vraag-JaNee "Nieuwe ENCRYPTION_KEY en HOOFDADMIN_SETUP_CODE zetten voor '$Naam'?")) { exit 0 }
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 32; $rng.GetBytes($bytes)
        $sleutel = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $alfabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
        $codeBytes = New-Object byte[] 16; $rng.GetBytes($codeBytes)
        $code = -join ($codeBytes | ForEach-Object { $alfabet[$_ % 32] })
        $code = ($code -split '(.{4})' | Where-Object { $_ }) -join '-'
        $vlag = EnvVlag $Naam
        Push-Location -LiteralPath $Backend
        try {
            $sleutel | & cmd.exe /c "npx wrangler secret put ENCRYPTION_KEY$vlag"
            if ($LASTEXITCODE -ne 0) { Stop-Hier 'ENCRYPTION_KEY zetten mislukt.' }
            $code | & cmd.exe /c "npx wrangler secret put HOOFDADMIN_SETUP_CODE$vlag"
            if ($LASTEXITCODE -ne 0) { Stop-Hier 'HOOFDADMIN_SETUP_CODE zetten mislukt.' }
        }
        finally { Pop-Location }
        Write-Host ''
        Toon-Let-Op 'Bewaar deze waarden NU in je wachtwoordkluis. Ze worden niet opnieuw getoond:'
        Write-Host "  ENCRYPTION_KEY        $sleutel"
        Write-Host "  HOOFDADMIN_SETUP_CODE $code   (voor de eerste aanmelding van HOOFDADMIN_EMAIL op /dashboard/activeren)"
        Write-Host ''
        Write-Host 'Optioneel: TURNSTILE_SECRET en de mailgeheimen, zoals in Stappenplan_Livegang.md, met:'
        Write-Host "  cd inschrijvingsplatform\backend ; npx wrangler secret put <NAAM>$vlag"
    }

    'deploy' {
        if ($Naam -eq 'alle') {
            $lijst = @(Installaties | Where-Object { $_ -eq 'test' }) + @(Installaties | Where-Object { $_ -notin @('test', 'productie') }) + @('productie')
            Write-Host "Volgorde: $($lijst -join ' -> ')"
            foreach ($i in $lijst) {
                Controleer-Naam $i
                if ($i -eq 'productie' -and -not (Vraag-JaNee 'Alles hierboven gelukt. Nu productie (FMG) bijwerken?')) { exit 0 }
                Deploy $i
            }
        }
        else {
            Controleer-Naam $Naam
            if ($Naam -eq 'productie' -and -not (Vraag-JaNee 'Productie (FMG) bijwerken?')) { exit 0 }
            Deploy $Naam
        }
    }

    default { Stop-Hier "Onbekende opdracht '$Opdracht'. Kies: lijst, nieuw, geheimen, deploy." }
}
