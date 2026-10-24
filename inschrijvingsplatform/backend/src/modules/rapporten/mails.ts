import { esc, type SjabloonDefinitie, type Velden } from '../../kern/sjablonen';
import { mailVolgensSjabloon, type Mail } from '../../mail';

/** De klaslijst voor een leerkracht, als sjabloon (zie kern/sjablonen.ts). */

interface Lijst {
  titel: string;
  moment: string;
  uur: string;
  lokaal: string | null;
  capaciteit: number | null;
  deelnemers: { voornaam: string; naam: string; school: string; leerjaar: string; status: string }[];
}

function lijstenHtml(lijsten: Lijst[]) {
  const cel = 'style="border:1px solid #cfd6df;padding:3px 8px;text-align:left"';
  return {
    html: lijsten
      .map((l) => {
        const rijen = l.deelnemers
          .map((d, i) => `<tr><td ${cel}>${i + 1}</td><td ${cel}>${esc(d.voornaam)}</td><td ${cel}>${esc(d.naam)}</td><td ${cel}>${esc(d.school)}</td><td ${cel}>${esc(d.leerjaar)}</td><td ${cel}>${d.status === 'wachtlijst' ? 'wachtlijst' : ''}</td></tr>`)
          .join('');
        const ingeschreven = l.deelnemers.filter((d) => d.status !== 'wachtlijst').length;
        return `<h3 style="margin:18px 0 4px">${esc(l.titel)}</h3>
<p style="margin:0 0 6px">${esc(l.moment)} · ${esc(l.uur)}${l.lokaal ? ` · lokaal ${esc(l.lokaal)}` : ''} · <strong>${ingeschreven}${l.capaciteit != null ? ` / ${l.capaciteit}` : ''}</strong> ingeschreven</p>
${rijen
  ? `<table style="border-collapse:collapse"><tr><th ${cel}>#</th><th ${cel}>Voornaam</th><th ${cel}>Achternaam</th><th ${cel}>School</th><th ${cel}>Leerjaar</th><th ${cel}></th></tr>${rijen}</table>`
  : '<p><em>Nog niemand ingeschreven.</em></p>'}`;
      })
      .join(''),
  };
}

export const SJABLONEN: SjabloonDefinitie[] = [
  {
    sleutel: 'klaslijst',
    reden: 'je als leerkracht een lesje geeft op {{evenement}} en {{afzender}} je de klaslijst stuurde',
    naam: 'Klaslijst voor een leerkracht',
    omschrijving: 'Rapporten → Klaslijsten → Mailen: elke leerkracht krijgt één mail met al zijn lesjes.',
    velden: [
      { naam: 'evenement', omschrijving: 'Naam van het evenement', voorbeeld: 'Infodagen 2027' },
      { naam: 'lesje', omschrijving: 'Titel van het lesje, als het er maar één is (anders leeg)', voorbeeld: 'Proeflesje Frans' },
      { naam: 'aantalLesjes', omschrijving: 'Aantal lesjes in deze mail', voorbeeld: '1' },
      { naam: 'meerdere', omschrijving: 'Ingevuld als er meer dan één lesje is (voor "klaslijsten" in het meervoud)', voorbeeld: '' },
      { naam: 'stand', omschrijving: 'Datum en uur van de lijst', voorbeeld: '20/01/2027 14:05' },
      { naam: 'afzender', omschrijving: 'Wie de lijst mailde', voorbeeld: 'An Janssens' },
      {
        naam: 'klaslijsten',
        omschrijving: 'Per lesje: titel, moment, lokaal en een tabel met de leerlingen (blok)',
        voorbeeld: lijstenHtml([{ titel: 'Proeflesje Frans', moment: 'Zaterdag – Voormiddag – Keuze 1', uur: '09:30 – 10:15', lokaal: 'B1.04', capaciteit: 12,
          deelnemers: [{ voornaam: 'Lotte', naam: 'Proef', school: 'De Boomhut', leerjaar: '6de leerjaar', status: 'bevestigd' }] }]),
      },
    ],
    standaard: {
      onderwerp: 'Klaslijst {{evenement}}{{#lesje}}: {{lesje}}{{/lesje}}{{^lesje}} ({{aantalLesjes}} lesjes){{/lesje}}',
      tekst: `Beste,

Hieronder de klaslijst{{#meerdere}}en{{/meerdere}} voor **{{evenement}}**, stand van {{stand}}.

{{klaslijsten}}

Verstuurd door {{afzender}} via het Inschrijvingsplatform. Deze lijst bevat persoonsgegevens van leerlingen: enkel gebruiken voor deze activiteit en niet verder delen.`,
    },
  },
];

export function klaslijstmail(p: { aan: string; evenement: string; afzender: string; lijsten: Lijst[] }): Mail {
  const velden: Velden = {
    evenement: p.evenement,
    lesje: p.lijsten.length === 1 ? p.lijsten[0].titel : null,
    aantalLesjes: String(p.lijsten.length),
    meerdere: p.lijsten.length > 1 ? 'ja' : null,
    stand: new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' }),
    afzender: p.afzender,
    klaslijsten: lijstenHtml(p.lijsten),
  };
  return mailVolgensSjabloon(SJABLONEN[0], velden, { aan: p.aan, type: 'klaslijst' });
}
