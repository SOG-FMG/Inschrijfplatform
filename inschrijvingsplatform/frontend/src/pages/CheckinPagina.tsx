/**
 * /checkin/<token>: het adres in de QR-code van de bevestigingsmail. Wie de code zelf scant, komt hier.
 * Het registreren van de aanwezigheid gebeurt later door het onthaal (scanner met aanmelding), niet op deze pagina.
 */
export function CheckinPagina() {
  return (
    <main className="pagina">
      <section className="kaartblok">
        <h1>QR-code voor het onthaal</h1>
        <p>Deze code is je toegangsbewijs. Toon de QR-code uit je bevestigingsmail bij aankomst aan het onthaal; daar wordt je aanwezigheid geregistreerd.</p>
        <p>Je inschrijving bekijken, wijzigen of annuleren doe je met de persoonlijke link in dezelfde mail.</p>
      </section>
    </main>
  );
}
