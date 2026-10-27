import { verstuur } from '../../mail';
import type { Env } from '../../types';
import { vandaag } from './capaciteit';
import { basisUrl } from './checkin';
import { herinneringsmail } from './mails';
import { mailGegevens } from './registratie';

/**
 * Herinneringsmail kort voor het evenement, verstuurd door de dagelijkse taak.
 *
 * Per evenementdag stel je bij Instellingen → Dagen in wanneer ze mag vertrekken (veld
 * `evenement_dagen.herinnering_op`). Leeg = geen herinnering. De cron loopt één keer per dag, dus de
 * herinnering vertrekt op de eerste run ná dat tijdstip.
 *
 * Wie er géén krijgt: wie geannuleerd is, wie op "komt niet" staat, wie geanonimiseerd is, en wie ze al kreeg
 * (tabel `herinneringen`, één rij per deelnemer en dag).
 */

/**
 * Hoeveel per run. Een cron-run heeft begrensde tijd en subrequests, dus dit is een plafond en geen doel: wat
 * er niet meer bij past, gaat op de volgende run mee. Zet het niet te laag, want dat kost een hele dag.
 */
const PER_RUN = 500;

export async function verstuurHerinneringen(env: Env) {
  const nu = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `select distinct i.deelnemer_id, i.dag_id
     from inschrijvingen i
     join evenement_dagen d on d.dag_id = i.dag_id
     join evenementen e on e.evenement_id = d.evenement_id
     join deelnemers dn on dn.deelnemer_id = i.deelnemer_id
     where d.herinnering_op is not null and d.herinnering_op <= ?1
       and d.status = 'actief' and d.datum >= ?2
       and e.status = 'gepubliceerd'
       and i.sessie_id is null and i.status <> 'geannuleerd'
       and dn.status = 'actief' and dn.komt_niet = 0 and dn.geanonimiseerd_op is null
       and not exists (select 1 from herinneringen h where h.deelnemer_id = i.deelnemer_id and h.dag_id = i.dag_id)
     limit ?3`,
  )
    .bind(nu, vandaag(), PER_RUN)
    .all<{ deelnemer_id: string; dag_id: string }>();

  let verstuurd = 0;
  let overgeslagen = 0;
  for (const r of results) {
    // Eerst vastleggen dát ze verstuurd is. Breekt de run af na het versturen, dan is een gemiste herinnering
    // minder erg dan een dubbele. `insert or ignore` is tegelijk de controle: 0 wijzigingen = iemand anders was er al.
    const gezet = await env.DB.prepare(`insert or ignore into herinneringen (deelnemer_id, dag_id) values (?, ?)`)
      .bind(r.deelnemer_id, r.dag_id)
      .run();
    if (!gezet.meta.changes) continue;

    const g = await mailGegevens(env, r.deelnemer_id);
    if (!g?.email) {
      overgeslagen++;
      continue;
    }
    // Enkel het moment en de lesjes van déze dag: een herinnering per dag, niet het hele overzicht.
    const momenten = g.momenten.filter((m) => m.dagId === r.dag_id);
    const keuzes = g.keuzes.filter((k) => k.dagId === r.dag_id);
    if (!momenten.length) {
      overgeslagen++;
      continue;
    }
    await verstuur(
      env,
      herinneringsmail({
        aan: g.email,
        voornaam: g.voornaam,
        evenement: g.evenement,
        referentie: g.referentie,
        momenten,
        keuzes,
        contactEmail: g.contactEmail,
        checkin: { basisUrl: basisUrl(env), ...g.checkin },
      }),
    );
    verstuurd++;
  }
  return { verstuurd, overgeslagen, bekeken: results.length };
}
