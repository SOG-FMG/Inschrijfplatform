# Installaties van het platform beheren (een installatie = een organisatie, zie Plan_Modulair_Platform.md).
#
# Gebruik (in de terminal van VS Code, in de map van de repository):
#     .\installaties.ps1 lijst                 toont de installaties uit backend\wrangler.toml
#     .\installaties.ps1 nieuw <naam>          maakt D1 en R2 aan voor een nieuwe installatie
#     .\installaties.ps1 geheimen <naam>       zet ENCRYPTION_KEY en HOOFDADMIN_SETUP_CODE (eenmalig, na de eerste deploy)
#     .\installaties.ps1 deploy <naam>         migreert en deployt een installatie (fmg: enkel migraties en API)
#     .\installaties.ps1 deploy alle           eerst test, dan de andere, fmg als laatste
#
# "fmg" is de installatie van FMG (de waarden bovenaan wrangler.toml, zonder --env).
# Een push naar main deployt fmg ook automatisch (Workers Builds), maar voert GEEN migraties uit.
# Bevat een versie een migratie? Gebruik dan dit script, of voer de migratie uit voor je pusht.
#
# Bij deploy/geheimen wordt gecontroleerd of je met het juiste Cloudflare-account aangemeld bent
# (HOOFDADMIN_EMAIL van de installatie vs. npx wrangler whoami). Klopt dat niet: eerst
# npx wrangler login met het juiste account, anders vraagt het script een bevestiging.
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

# Installaties = fmg + elke [env.<naam>] in backend\wrangler.toml.
function Installaties {
    $toml = Get-Content -LiteralPath (Join-Path $Backend 'wrangler.toml')
    $envs = @($toml | ForEach-Object { if ($_ -match '^\[env\.([a-z0-9-]+)\]\s*$') { $Matches[1] } })
    return @('fmg') + $envs
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

function EnvVlag($naam) { if ($naam -eq 'fmg') { return '' } else { return " --env $naam" } }

# Het stuk van wrangler.toml van deze installatie: voor 'fmg' alles bovenaan (voor de eerste [env.]),
# anders van [env.<naam>] tot de volgende installatie. Commentaarregels (bv. het sjabloon onderaan) tellen niet mee.
function Installatie-Blok($naam) {
    $toml = (Get-Content -LiteralPath (Join-Path $Backend 'wrangler.toml') | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    if ($naam -eq 'fmg') { return ($toml -split "\n\[env\.", 2)[0] }
    return (($toml -split "\[env\.$naam\]", 2)[1] -split "\n\[env\.(?!$naam[.\]])", 2)[0]
}

function Controleer-Naam($naam) {
    if (-not $naam) { Stop-Hier 'Geef een naam op, bv.: .\installaties.ps1 deploy test' }
    if ($naam -notin (Installaties)) { Stop-Hier "Onbekende installatie '$naam'. Bekend: $((Installaties) -join ', '). Voeg ze eerst toe in backend\wrangler.toml (sjabloon onderaan)." }
    if ($naam -eq 'fmg') { return }
    if ((Installatie-Blok $naam) -match 'VUL-IN-NA-AANMAKEN') { Stop-Hier "In wrangler.toml staat voor '$naam' nog geen database_id. Voer eerst uit: .\installaties.ps1 nieuw $naam" }
}

# E-mailadres waarmee Wrangler nu is aangemeld. Werkt met een OAuth-login (npx wrangler login); met een
# API-token (CLOUDFLARE_API_TOKEN) toont whoami geen e-mailadres en geeft dit $null.
function Aangemeld-Email {
    $uitvoer = & cmd.exe /c "npx wrangler whoami 2>&1" | Out-String
    if ($uitvoer -match 'associated with the email (\S+)') { return $Matches[1].TrimEnd('.') }
    return $null
}

# Voorkomt dat een deploy, migratie of secret in het verkeerde Cloudflare-account belandt: vergelijkt het
# aangemelde e-mailadres met HOOFDADMIN_EMAIL van deze installatie in wrangler.toml (elke installatie
# hoort bij het Cloudflare-account van haar eigen hoofdbeheerder). Geen HOOFDADMIN_EMAIL gevonden, of
# whoami geeft geen e-mailadres: niets om tegen te vergelijken, dus stilletjes verdergaan.
function Controleer-Account($naam) {
    if ((Installatie-Blok $naam) -notmatch 'HOOFDADMIN_EMAIL\s*=\s*"([^"]+)"') { return }
    $verwacht = $Matches[1]
    $huidig = Aangemeld-Email
    if (-not $huidig) { return }
    if ($huidig.ToLower() -ne $verwacht.ToLower()) {
        Toon-Let-Op "Aangemeld als '$huidig', maar '$naam' hoort bij het Cloudflare-account van '$verwacht'."
        Write-Host '  Meld je aan met het juiste account: cd inschrijvingsplatform\backend ; npx wrangler login'
        if (-not (Vraag-JaNee 'Toch doorgaan?')) { exit 0 }
    }
    else {
        Toon-Ok "Aangemeld als $huidig (juiste account voor '$naam')."
    }
}

function Deploy($naam) {
    Toon-Kop "Deploy: $naam"
    Controleer-Account $naam
    $vlag = EnvVlag $naam
    Voer-Uit $Backend 'node tools/migraties.mjs --controleer'
    Voer-Uit $Backend "npx wrangler d1 migrations apply DB --remote$vlag"
    Voer-Uit $Backend "npx wrangler deploy$vlag"
    if ($naam -eq 'fmg') {
        # De build-variabelen van fmg (o.a. de Turnstile-sitekey) staan in het Cloudflare-dashboard; een lokale bouw zou ze missen.
        Toon-Let-Op 'Frontend van fmg: wordt door Cloudflare gebouwd bij een push naar main (of Deployments > Retry).'
    }
    else {
        # Lokaal bouwen met de API achter dezelfde hostnaam. Eigen waarden per installatie (bv. VITE_STANDAARD_EVENEMENT,
        # VITE_TURNSTILE_SITEKEY) in frontend\.env.<naam>; Vite leest dat bestand met --mode <naam>.
        $env:VITE_API_URL = '/'
        Voer-Uit $Frontend 'npx tsc --noEmit -p .'
        Voer-Uit $Frontend "npx vite build --mode $naam"
        Voer-Uit $Frontend "npx wrangler deploy$vlag"
    }
    Toon-Ok "$naam is bijgewerkt."
}

switch ($Opdracht) {
    'lijst' {
        Toon-Kop 'Installaties'
        Installaties | ForEach-Object { Write-Host "  $_" }
    }

    'nieuw' {
        if (-not $Naam -or $Naam -eq 'fmg' -or $Naam -notmatch '^[a-z0-9-]+$') { Stop-Hier 'Geef een naam in kleine letters, bv.: .\installaties.ps1 nieuw meulestede' }
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
        Controleer-Account $Naam
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
            $lijst = @(Installaties | Where-Object { $_ -eq 'test' }) + @(Installaties | Where-Object { $_ -notin @('test', 'fmg') }) + @('fmg')
            Write-Host "Volgorde: $($lijst -join ' -> ')"
            foreach ($i in $lijst) {
                Controleer-Naam $i
                if ($i -eq 'fmg' -and -not (Vraag-JaNee 'Alles hierboven gelukt. Nu FMG bijwerken?')) { exit 0 }
                Deploy $i
            }
        }
        else {
            Controleer-Naam $Naam
            if ($Naam -eq 'fmg' -and -not (Vraag-JaNee 'FMG bijwerken?')) { exit 0 }
            Deploy $Naam
        }
    }

    default { Stop-Hier "Onbekende opdracht '$Opdracht'. Kies: lijst, nieuw, geheimen, deploy." }
}
