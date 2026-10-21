import type { Profiel } from '../services/beheerApi';
import { datum, Link, STATUSNAAM } from './ui';

/** Overzicht van privacy per evenement en hoe het platform met gegevens omgaat. */
export function Privacy({ profiel }: { profiel: Profiel }) {
  const anonimisering = (eind: string, dagen: number) => {
    const d = new Date(`${eind}T12:00:00`);
    d.setDate(d.getDate() + dagen);
    return d.toISOString().slice(0, 10);
  };
  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Privacy</h1>
          <p className="d-sub">Privacytekst en bewaartermijn per evenement. Na de bewaartermijn worden persoonsgegevens automatisch gewist (elke nacht).</p>
        </div>
      </header>

      <div className="d-tabelvak">
        <table className="d-tabel">
          <thead>
            <tr>
              <th>Evenement</th>
              <th>Status</th>
              <th>Privacytekst</th>
              <th className="getal">Bewaartermijn</th>
              <th>Gegevens gewist vanaf</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            {profiel.evenementen.map((e) => (
              <tr key={e.id}>
                <td><strong>{e.titel}</strong></td>
                <td><span className={`d-badge d-badge--${e.status}`}>{STATUSNAAM[e.status] ?? e.status}</span></td>
                <td>{e.heeftPrivacytekst ? <span className="d-ok">Ingevuld</span> : <span className="d-nee">Ontbreekt</span>}</td>
                <td className="getal">{e.bewaartermijn} dagen</td>
                <td>{datum(anonimisering(e.eind, e.bewaartermijn))}</td>
                <td className="d-acties">
                  <Link href={`/dashboard/evenementen/${e.id}`}>Aanpassen</Link>
                  <a href={`/${e.slug}`} target="_blank" rel="noreferrer">Formulier ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="d-kaart">
        <h2>Hoe het platform met gegevens omgaat</h2>
        <ul className="d-lijst">
          <li>Namen, e-mailadressen, telefoonnummers en opmerkingen van deelnemers staan <strong>versleuteld</strong> (AES-256) in de database, in de EU.</li>
          <li>Enkel aangemelde medewerkers met toegang tot het evenement zien ze, via de deelnemerslijst. Elke export wordt gelogd.</li>
          <li>Na de bewaartermijn worden de persoonsgegevens gewist; de aantallen blijven bewaard voor statistiek.</li>
          <li>Ouders kunnen hun inschrijving zelf bekijken en annuleren via de persoonlijke link na het inschrijven.</li>
          <li>Een geëxporteerd Excel-bestand valt buiten het platform: bewaar het op een beveiligde plaats en verwijder het na gebruik.</li>
        </ul>
      </section>
    </>
  );
}
