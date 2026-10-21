# Test de Power Automate-flow (Teams Workflows-webhook) VOORDAT je hem aan het platform koppelt.
#
# Gebruik:
#     powershell -ExecutionPolicy Bypass -File .\inschrijvingsplatform\tools\test-mail-flow.ps1
#
# Het script vraagt het webhook-adres en de sleutel verborgen en stuurt een testbericht naar JOUW adres,
# in exact dezelfde vorm als het platform (velden: sleutel, type, referentie, aan, onderwerp, html).
# Niets wordt bewaard. Dit bestand bevat bewust geen accenten.

param(
    [string]$Aan = 'valentijn.rombaut@onderwijs.gent.be'
)

$ErrorActionPreference = 'Stop'

function Lees-Geheim($vraag) {
    $veilig = Read-Host $vraag -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($veilig)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$url = Lees-Geheim 'Webhook-adres van de flow (wordt niet getoond)'
$sleutel = Lees-Geheim 'Sleutel (het gedeelde geheim; leeg laten als je nog geen sleutel gebruikt)'

$uri = $null
if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') {
    Write-Host 'X  Dit is geen geldig https-adres.' -ForegroundColor Red
    exit 1
}
if ($uri.Host -notmatch '(\.logic\.azure\.com|\.powerplatform\.com|\.powerautomate\.com)$') {
    Write-Host "!  Let op: $($uri.Host) is geen gekend Power Automate-adres. Het platform zal dit adres weigeren." -ForegroundColor Yellow
}

$bericht = [ordered]@{
    sleutel    = $sleutel
    type       = 'test'
    referentie = 'TEST0001'
    aan        = $Aan
    onderwerp  = '[Inschrijvingsplatform] Testmail van de flow'
    html       = '<p>Dit is een <strong>testmail</strong> om de flow te controleren.</p><p>Link: <a href="https://example.org/beheer/voorbeeld">persoonlijke link</a></p>'
}
$json = $bericht | ConvertTo-Json -Compress

try {
    $antwoord = Invoke-WebRequest -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing
    Write-Host ''
    Write-Host "OK  De flow antwoordde met status $($antwoord.StatusCode)." -ForegroundColor Green
    Write-Host "    Kijk in de mailbox van $Aan (kan een minuut duren)."
    Write-Host '    Staat de mail er niet? Open de flow in Power Automate -> Uitvoeringsgeschiedenis en kijk welke stap faalde.'
}
catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    Write-Host ''
    Write-Host "X  Mislukt$(if ($status) { " (status $status)" })." -ForegroundColor Red
    switch ($status) {
        401 { Write-Host '   Het webhook-adres klopt niet meer of de handtekening (sig=) ontbreekt. Kopieer het adres opnieuw uit de flow.' }
        403 { Write-Host '   Geweigerd: de flow laat deze aanroep niet toe (kijk bij de trigger wie de flow mag starten).' }
        404 { Write-Host '   De flow bestaat niet (meer) of staat uit. Zet hem aan in Power Automate.' }
        default { Write-Host "   $($_.Exception.Message)" }
    }
}
