# Commit-hulp voor het inschrijvingsplatform.
#
# Gebruik (in de terminal van VS Code, in de map van de repository):
#     .\commit.ps1
#
# Wat het doet:
#   1. toont wat er gewijzigd is en laat je kiezen welke bestanden mee gaan
#   2. houdt verdachte bestanden (sleutels, .env, logs, .wrangler) standaard tegen
#   3. voert de controles uit (TypeScript en tests) van de delen die je wijzigde
#   4. zoekt in de wijzigingen naar iets dat op een geheim lijkt
#   5. vraagt om een commitnaam en commit
#   6. biedt aan om te pushen en vangt de gewone problemen op
#
# Opmerking: dit bestand bevat bewust geen accenten, zodat het in elke PowerShell werkt.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# ---------------------------------------------------------------------------
# Hulpfuncties
# ---------------------------------------------------------------------------
function Toon-Kop($tekst) { Write-Host ''; Write-Host "== $tekst ==" -ForegroundColor Cyan }
function Toon-Ok($tekst) { Write-Host "OK  $tekst" -ForegroundColor Green }
function Toon-Let-Op($tekst) { Write-Host "!   $tekst" -ForegroundColor Yellow }
function Toon-Fout($tekst) { Write-Host "X   $tekst" -ForegroundColor Red }

function Stop-Hier($tekst) {
    Toon-Fout $tekst
    exit 1
}

# Vraagt ja/nee. $standaard is 'j' of 'n' en geldt als je enkel op Enter drukt.
function Vraag-JaNee($vraag, $standaard = 'j') {
    $hint = if ($standaard -eq 'j') { '[J/n]' } else { '[j/N]' }
    while ($true) {
        $antwoord = ([string](Read-Host "$vraag $hint")).Trim().ToLower()
        if ($antwoord -eq '') { return ($standaard -eq 'j') }
        if ($antwoord -in @('j', 'ja', 'y', 'yes')) { return $true }
        if ($antwoord -in @('n', 'nee', 'no')) { return $false }
        Write-Host 'Antwoord met j of n.'
    }
}

# Voert git uit en geeft de uitvoer (regels) terug. Stopt niet zelf bij een foutcode.
function Git-Uit {
    $uit = & git.exe @args
    $script:GitCode = $LASTEXITCODE
    return @($uit)
}

# Voert een controle uit in een submap. Geeft $true bij succes.
function Voer-Controle-Uit($naam, $map, $commando) {
    Write-Host ''
    Write-Host "-> $naam" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "$map\node_modules"))) {
        Toon-Let-Op "In $map ontbreekt node_modules. Voer eerst uit: cd $map ; npm install"
        return $false
    }
    Push-Location -LiteralPath (Join-Path $PSScriptRoot $map)
    try {
        & cmd.exe /c $commando
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($code -eq 0) { Toon-Ok $naam; return $true }
    Toon-Fout "$naam is mislukt (foutcode $code)."
    return $false
}

# Bestanden die je bijna nooit wilt committen.
$VerdachtePatronen = @(
    '(^|/)\.dev\.vars$',
    '(^|/)\.env(\.[^/]*)?$',
    '\.pem$', '\.key$', '\.pfx$', '\.p12$',
    '(^|/)\.wrangler/',
    '\.build\.log$',
    '(^|/)Bronnen instructie/',
    '\.(csv|xlsx)$'
)
function Is-Verdacht($pad) {
    if ($pad -match '\.(example|sample)$') { return $false }
    foreach ($p in $VerdachtePatronen) { if ($pad -match $p) { return $true } }
    return $false
}

# ---------------------------------------------------------------------------
# 0. Voorwaarden
# ---------------------------------------------------------------------------
try {
    Toon-Kop 'Voorwaarden'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Hier 'Git is niet geinstalleerd of niet gevonden in het pad.' }

    $null = Git-Uit rev-parse --is-inside-work-tree
    if ($GitCode -ne 0) { Stop-Hier 'Dit is geen Git-repository.' }

    $tak = [string]@(Git-Uit branch --show-current)[0]
    if (-not $tak) { Stop-Hier 'Je bent niet op een branch (detached HEAD). Ga eerst naar een branch, bv. met: git switch main' }
    Toon-Ok "Branch: $tak"

    $naam = [string]@(Git-Uit config user.name)[0]
    $mail = [string]@(Git-Uit config user.email)[0]
    if (-not $naam -or -not $mail) {
        Stop-Hier 'Git kent je naam of e-mailadres niet. Stel in met: git config --global user.name "Naam" en git config --global user.email "adres"'
    }
    Toon-Ok "Auteur: $naam <$mail>"

    # Een lopende merge of rebase eerst afwerken.
    $gitMap = [string]@(Git-Uit rev-parse --git-dir)[0]
    foreach ($teken in @('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD')) {
        if (Test-Path -LiteralPath (Join-Path $gitMap $teken)) {
            Stop-Hier "Er loopt nog een merge/rebase/cherry-pick ($teken). Werk die eerst af (git status toont wat er nog moet), of breek af met git merge --abort / git rebase --abort."
        }
    }

    # -----------------------------------------------------------------------
    # 1. Wijzigingen tonen en bestanden kiezen
    # -----------------------------------------------------------------------
    Toon-Kop 'Wijzigingen'
    $regels = Git-Uit -c core.quotepath=off status --porcelain -uall
    $regels = @($regels | Where-Object { $_ })
    if ($regels.Count -eq 0) {
        Toon-Ok 'Er is niets te committen.'
        exit 0
    }

    $bestanden = @()
    foreach ($r in $regels) {
        $status = $r.Substring(0, 2)
        $pad = $r.Substring(3)
        if ($pad -match ' -> ') { $pad = ($pad -split ' -> ')[1] }   # hernoemd
        $pad = $pad.Trim('"')
        $bestanden += [pscustomobject]@{ Status = $status; Pad = $pad; Verdacht = (Is-Verdacht $pad) }
    }

    foreach ($b in $bestanden) {
        $kleur = if ($b.Verdacht) { 'Yellow' } else { 'Gray' }
        $merk = if ($b.Verdacht) { '  <- verdacht, standaard niet mee' } else { '' }
        Write-Host ("{0}  {1}{2}" -f $b.Status, $b.Pad, $merk) -ForegroundColor $kleur
    }
    Write-Host ''
    Write-Host 'Betekenis: M = gewijzigd, A = nieuw, D = verwijderd, ?? = nog niet bijgehouden'

    Write-Host ''
    Write-Host 'Welke bestanden gaan mee?'
    Write-Host '  1  Alles behalve de verdachte bestanden (aanbevolen)'
    Write-Host '  2  Per bestand kiezen'
    Write-Host '  3  Wat ik al gestaged heb laten staan (niets extra toevoegen)'
    Write-Host '  q  Stoppen'
    $keuze = ''
    while ($keuze -notin @('1', '2', '3', 'q')) { $keuze = ([string](Read-Host 'Keuze')).Trim().ToLower() }
    if ($keuze -eq 'q') { Write-Host 'Gestopt, er is niets gecommit.'; exit 0 }

    if ($keuze -ne '3') {
        # Eerst alles uit de staging halen, zodat enkel jouw keuze overblijft.
        $null = Git-Uit reset -q
        if ($keuze -eq '1') {
            foreach ($b in ($bestanden | Where-Object { -not $_.Verdacht })) { $null = Git-Uit add -A -- $b.Pad }
            $verdacht = @($bestanden | Where-Object { $_.Verdacht })
            if ($verdacht.Count -gt 0 -and (Vraag-JaNee "Toch $($verdacht.Count) verdacht(e) bestand(en) toevoegen?" 'n')) {
                foreach ($b in $verdacht) { $null = Git-Uit add -A -- $b.Pad }
            }
        }
        else {
            foreach ($b in $bestanden) {
                $standaard = if ($b.Verdacht) { 'n' } else { 'j' }
                if (Vraag-JaNee "Toevoegen: $($b.Pad)" $standaard) { $null = Git-Uit add -A -- $b.Pad }
            }
        }
    }

    $gestaged = @(Git-Uit -c core.quotepath=off diff --cached --name-only | Where-Object { $_ })
    if ($gestaged.Count -eq 0) { Stop-Hier 'Er is niets gekozen om te committen.' }
    Toon-Ok "$($gestaged.Count) bestand(en) gaan mee."

    # -----------------------------------------------------------------------
    # 2. Controles
    # -----------------------------------------------------------------------
    Toon-Kop 'Controles'
    $backendGewijzigd = @($gestaged | Where-Object { $_ -like 'inschrijvingsplatform/backend/*' }).Count -gt 0
    $frontendGewijzigd = @($gestaged | Where-Object { $_ -like 'inschrijvingsplatform/frontend/*' }).Count -gt 0
    $problemen = @()

    if ($backendGewijzigd) {
        if (-not (Voer-Controle-Uit 'Backend: TypeScript' 'inschrijvingsplatform\backend' 'npx tsc --noEmit')) { $problemen += 'Backend: TypeScript' }
        if (Vraag-JaNee 'Backend-tests draaien? (duurt ongeveer een minuut)' 'j') {
            if (-not (Voer-Controle-Uit 'Backend: tests' 'inschrijvingsplatform\backend' 'npm test')) { $problemen += 'Backend: tests' }
        }
    }
    if ($frontendGewijzigd) {
        if (-not (Voer-Controle-Uit 'Frontend: TypeScript' 'inschrijvingsplatform\frontend' 'npx tsc --noEmit')) { $problemen += 'Frontend: TypeScript' }
        if (-not (Voer-Controle-Uit 'Frontend: tests' 'inschrijvingsplatform\frontend' 'npm test')) { $problemen += 'Frontend: tests' }
    }
    if (-not $backendGewijzigd -and -not $frontendGewijzigd) { Toon-Ok 'Geen code gewijzigd, controles overgeslagen.' }

    # Een bouwbestand van TypeScript kan door de controle gewijzigd zijn: niet meenemen.
    $buildInfo = 'inschrijvingsplatform/frontend/tsconfig.tsbuildinfo'
    if (@(Git-Uit -c core.quotepath=off status --porcelain -- $buildInfo).Count -gt 0) {
        $null = Git-Uit reset -q -- $buildInfo
        $null = Git-Uit checkout -- $buildInfo
        $gestaged = @($gestaged | Where-Object { $_ -ne $buildInfo })
    }

    # Geheimen zoeken in wat je gaat committen (enkel toegevoegde regels).
    $toegevoegd = @(Git-Uit -c core.quotepath=off diff --cached -U0 | Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+' })
    $geheimPatronen = @(
        '(?i)(secret|password|wachtwoord|api[_-]?key|private[_-]?key|token)\w*\s*[=:]\s*["''][A-Za-z0-9_\-/+=]{16,}["'']',
        '-----BEGIN [A-Z ]*PRIVATE KEY-----',
        '\b0x4[A-Za-z0-9_-]{30,}\b',
        '\b[0-9a-f]{64}\b'
    )
    $geheimen = @()
    foreach ($regel in $toegevoegd) {
        foreach ($p in $geheimPatronen) { if ($regel -match $p) { $geheimen += $regel; break } }
    }
    if ($geheimen.Count -gt 0) {
        Toon-Let-Op 'Deze toegevoegde regels lijken op een geheim (sleutel, token, wachtwoord):'
        $geheimen | Select-Object -First 8 | ForEach-Object {
            $kort = if ($_.Length -gt 110) { $_.Substring(0, 110) + '...' } else { $_ }
            Write-Host "     $kort" -ForegroundColor Yellow
        }
        Write-Host '   Geheimen horen niet in Git. Zet ze met: npx wrangler secret put <NAAM>'
        $problemen += 'Mogelijk geheim in de wijzigingen'
    }

    if ($problemen.Count -gt 0) {
        Write-Host ''
        Toon-Let-Op ('Problemen: ' + ($problemen -join '; '))
        if (-not (Vraag-JaNee 'Toch committen?' 'n')) {
            Write-Host 'Gestopt. Los de problemen op en draai het script opnieuw. Je bestanden blijven gestaged.'
            exit 1
        }
    }

    # -----------------------------------------------------------------------
    # 3. Commitnaam en commit
    # -----------------------------------------------------------------------
    Toon-Kop 'Commit'
    Write-Host 'Een goede naam zegt wat er verandert, bv. "Aanmelden medewerkers: passkeys toegevoegd".'
    $bericht = ''
    while ($bericht.Length -lt 5) {
        $bericht = ([string](Read-Host 'Naam van de commit')).Trim()
        if ($bericht.Length -lt 5) { Toon-Let-Op 'Geef een iets duidelijkere naam (minstens 5 tekens).' }
    }
    if ($bericht.Length -gt 72) { Toon-Let-Op "De naam is $($bericht.Length) tekens lang. Korter leest makkelijker, maar het mag." }

    $uit = Git-Uit commit -m $bericht
    if ($GitCode -ne 0) {
        $uit | ForEach-Object { Write-Host $_ }
        Stop-Hier 'De commit is mislukt (bv. door een hook). Lees de melding hierboven, los het op en probeer opnieuw.'
    }
    $uit | ForEach-Object { Write-Host $_ }
    Toon-Ok 'Gecommit.'

    # -----------------------------------------------------------------------
    # 4. Pushen
    # -----------------------------------------------------------------------
    Toon-Kop 'Pushen'
    $nieuweMigratie = @($gestaged | Where-Object { $_ -like 'inschrijvingsplatform/backend/migrations/*' }).Count -gt 0
    if ($nieuweMigratie) {
        Toon-Let-Op 'Deze commit bevat een databasemigratie. Voer die uit VOOR je pusht (de push deployt de Worker):'
        Write-Host '     cd inschrijvingsplatform\backend ; npx wrangler d1 migrations apply DB --remote' -ForegroundColor Yellow
    }
    Write-Host 'Een push naar main start automatisch een nieuwe deploy op Cloudflare.'
    if (-not (Vraag-JaNee 'Nu pushen?' $(if ($nieuweMigratie) { 'n' } else { 'j' }))) {
        Write-Host "Niet gepusht. Doe het later met: git push"
        exit 0
    }

    $heeftUpstream = $true
    $null = Git-Uit rev-parse --abbrev-ref --symbolic-full-name '@{u}'
    if ($GitCode -ne 0) { $heeftUpstream = $false }

    $uit = if ($heeftUpstream) { Git-Uit push } else { Git-Uit push -u origin $tak }
    if ($GitCode -eq 0) {
        Toon-Ok 'Gepusht. Volg de build in het Cloudflare-dashboard (Workers & Pages).'
        exit 0
    }

    # Push mislukt: de gewone oorzaken opvangen.
    $tekst = ($uit -join "`n")
    Write-Host $tekst
    if ($tekst -match 'rejected|non-fast-forward|fetch first|behind') {
        Toon-Let-Op 'Op GitHub staan wijzigingen die jij nog niet hebt (bv. van een collega of een andere computer).'
        if (Vraag-JaNee 'Die ophalen en jouw commit erbovenop zetten (git pull --rebase)?' 'j') {
            $uit = Git-Uit pull --rebase
            $uit | ForEach-Object { Write-Host $_ }
            if ($GitCode -ne 0) {
                Stop-Hier 'Samenvoegen mislukt (conflict). Open de gemarkeerde bestanden in VS Code, los de conflicten op, voer git add <bestand> en git rebase --continue uit, en push daarna. Opgeven kan met git rebase --abort.'
            }
            $uit = Git-Uit push
            $uit | ForEach-Object { Write-Host $_ }
            if ($GitCode -eq 0) { Toon-Ok 'Gepusht.'; exit 0 }
        }
    }
    elseif ($tekst -match 'Authentication|denied|403|401|could not read Username') {
        Toon-Let-Op 'Aanmelden bij GitHub mislukt. Log in via VS Code (Accounts linksonder) of met: gh auth login'
    }
    elseif ($tekst -match 'Could not resolve host|unable to access') {
        Toon-Let-Op 'Geen verbinding met GitHub. Controleer je internet of VPN.'
    }
    Stop-Hier 'Pushen is niet gelukt. De commit staat wel lokaal. Probeer later opnieuw met: git push'
}
catch {
    Toon-Fout "Onverwachte fout: $($_.Exception.Message)"
    Write-Host 'Er is niets verloren: je bestanden en eventuele commit staan nog lokaal. Controleer met: git status'
    exit 1
}
