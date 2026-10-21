# Test of SMTP AUTH (basisauthenticatie) werkt voor een Microsoft 365-mailbox.
#
# Gebruik (in PowerShell):
#     .\inschrijvingsplatform\tools\test-smtp.ps1
#     .\inschrijvingsplatform\tools\test-smtp.ps1 -Adres freinetmiddenschool.automatisatie@onderwijs.gent.be
#
# Wat het doet:
#   1. verbindt met smtp.office365.com:587 en schakelt over naar TLS (STARTTLS)
#   2. toont welke aanmeldmethodes de server aanbiedt
#   3. probeert aan te melden met het adres en wachtwoord (AUTH LOGIN)
#   4. meldt af (QUIT). Er wordt GEEN mail verstuurd.
#
# Het wachtwoord wordt verborgen gevraagd, enkel naar Microsoft gestuurd (versleuteld via TLS)
# en nergens bewaard. Dit bestand bevat bewust geen accenten.

param(
    [string]$Adres = 'freinetmiddenschool.automatisatie@onderwijs.gent.be',
    [string]$Server = 'smtp.office365.com',
    [int]$Poort = 587
)

$ErrorActionPreference = 'Stop'

function Lees-Antwoord($lezer) {
    # Een SMTP-antwoord kan meerdere regels hebben ("250-..." ... "250 ...").
    $regels = @()
    do {
        $regel = $lezer.ReadLine()
        if ($null -eq $regel) { throw 'De server verbrak de verbinding.' }
        $regels += $regel
    } while ($regel.Length -ge 4 -and $regel[3] -eq '-')
    return $regels
}

function Stuur($schrijver, $lezer, $opdracht, [switch]$Verborgen) {
    $toon = if ($Verborgen) { '(verborgen)' } else { $opdracht }
    Write-Host "> $toon" -ForegroundColor DarkGray
    $schrijver.WriteLine($opdracht)
    $schrijver.Flush()
    $antwoord = Lees-Antwoord $lezer
    $antwoord | ForEach-Object { Write-Host "< $_" -ForegroundColor Gray }
    return $antwoord
}

$tcp = $null
try {
    Write-Host ''
    Write-Host "SMTP AUTH-test voor $Adres via ${Server}:$Poort" -ForegroundColor Cyan
    $wachtwoordVeilig = Read-Host "Wachtwoord van $Adres (wordt niet getoond)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($wachtwoordVeilig)
    $wachtwoord = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    # 1. Verbinden (platte tekst) en STARTTLS
    $tcp = New-Object Net.Sockets.TcpClient
    $tcp.Connect($Server, $Poort)
    $stroom = $tcp.GetStream()
    $lezer = New-Object IO.StreamReader($stroom, [Text.Encoding]::ASCII)
    $schrijver = New-Object IO.StreamWriter($stroom, [Text.Encoding]::ASCII)
    $schrijver.NewLine = "`r`n"
    Lees-Antwoord $lezer | ForEach-Object { Write-Host "< $_" -ForegroundColor Gray }
    $null = Stuur $schrijver $lezer 'EHLO test.local'
    $tls = @(Stuur $schrijver $lezer 'STARTTLS')
    if ($tls[-1] -notmatch '^220') { throw 'De server weigert STARTTLS.' }

    $ssl = New-Object Net.Security.SslStream($stroom, $false)
    $ssl.AuthenticateAsClient($Server, $null, [Security.Authentication.SslProtocols]::Tls12, $true)
    $lezer = New-Object IO.StreamReader($ssl, [Text.Encoding]::ASCII)
    $schrijver = New-Object IO.StreamWriter($ssl, [Text.Encoding]::ASCII)
    $schrijver.NewLine = "`r`n"
    Write-Host '  (TLS actief)' -ForegroundColor DarkGray

    # 2. Aanmeldmethodes
    $ehlo = @(Stuur $schrijver $lezer 'EHLO test.local')
    $auth = ($ehlo | Where-Object { $_ -match 'AUTH ' }) -join ' '
    Write-Host ''
    if (-not $auth) {
        Write-Host 'X  De server biedt na TLS geen AUTH aan: SMTP AUTH is uitgeschakeld.' -ForegroundColor Red
        return
    }
    Write-Host "Aangeboden aanmeldmethodes: $($auth -replace '^.*AUTH ', '')"
    if ($auth -notmatch 'LOGIN') { Write-Host '!  AUTH LOGIN wordt niet aangeboden (enkel OAuth?).' -ForegroundColor Yellow }

    # 3. Aanmelden
    $b64 = { param($t) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)) }
    $null = Stuur $schrijver $lezer 'AUTH LOGIN'
    $null = Stuur $schrijver $lezer (& $b64 $Adres)
    $resultaat = @(Stuur $schrijver $lezer (& $b64 $wachtwoord) -Verborgen)
    $wachtwoord = $null
    $tekst = $resultaat -join ' '

    Write-Host ''
    Write-Host '== Resultaat ==' -ForegroundColor Cyan
    switch -Regex ($tekst) {
        '^235' { Write-Host 'OK  SMTP AUTH werkt voor deze mailbox. (Er is geen mail verstuurd.)' -ForegroundColor Green; break }
        '5\.7\.139.*disabled for the (Tenant|tenant)' { Write-Host 'X  SMTP AUTH staat UIT voor de hele tenant (Onderwijs Gent).' -ForegroundColor Red; break }
        '5\.7\.139.*disabled for the (Mailbox|mailbox)' { Write-Host 'X  SMTP AUTH staat UIT voor deze mailbox.' -ForegroundColor Red; break }
        '5\.7\.139.*(security defaults|Security defaults)' { Write-Host 'X  Geblokkeerd door de beveiligingsstandaarden van de tenant.' -ForegroundColor Red; break }
        '5\.7\.139.*(Conditional Access|conditional access)' { Write-Host 'X  Geblokkeerd door een Conditional Access-beleid.' -ForegroundColor Red; break }
        '5\.7\.139.*(blocked by user|Basic authentication is disabled)' { Write-Host 'X  Basisauthenticatie is uitgeschakeld (enkel nog OAuth).' -ForegroundColor Red; break }
        '5\.7\.30' { Write-Host 'X  Basisauthenticatie wordt niet meer ondersteund voor SMTP (enkel nog OAuth).' -ForegroundColor Red; break }
        '5\.7\.3' { Write-Host 'X  Aanmelden mislukt: verkeerd wachtwoord, of het account vereist MFA.' -ForegroundColor Red; break }
        default { Write-Host "?  Onbekend antwoord: $tekst" -ForegroundColor Yellow }
    }
}
catch {
    Write-Host "X  Fout: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '   Mogelijke oorzaak: poort 587 geblokkeerd door het netwerk of een firewall.'
}
finally {
    try { if ($schrijver) { $schrijver.WriteLine('QUIT'); $schrijver.Flush() } } catch {}
    if ($tcp) { $tcp.Close() }
    $wachtwoord = $null
}
