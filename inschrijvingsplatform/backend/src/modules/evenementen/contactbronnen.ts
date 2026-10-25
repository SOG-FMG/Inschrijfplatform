import { installatie } from '../../kern/installatie';
import type { ContactBron } from '../../kern/module';

/** Waar personen voorkomen in de module evenementen, voor de contactenlijst (kern/contactenlijst.ts). */

const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Sessiegevers (lesgevers): per sessie waaraan ze gekoppeld zijn, of "nog niet gekoppeld". */
export const SESSIEGEVERS_BRON: ContactBron = {
  id: 'sessiegevers',
  extern: false,
  async lees(env) {
    const term = hoofdletter(installatie(env).termen.sessiegever);
    const { results } = await env.DB.prepare(
      `select g.email, g.voornaam, g.naam, g.actief, s.titel, d.naam as dag, d.datum, t.start_uur, e.evenement_id, e.titel as evenement
       from sessiegevers g
       left join sessie_sessiegevers sg on sg.sessiegever_id = g.sessiegever_id
       left join sessies s on s.sessie_id = sg.sessie_id
       left join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       left join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       left join evenement_dagen d on d.dag_id = dd.dag_id
       left join evenementen e on e.evenement_id = d.evenement_id
       where g.email is not null
       order by d.datum, t.start_uur`,
    ).all<any>();
    return results.map((x) => ({
      email: x.email,
      naam: `${x.voornaam} ${x.naam}`.trim(),
      soort: term,
      omschrijving: x.titel ? `${x.evenement} · ${x.titel} (${x.dag}, ${x.start_uur})` : `Nog aan geen ${installatie(env).termen.sessiegever === 'lesgever' ? 'lesje' : 'sessie'} gekoppeld${x.actief ? '' : ' (inactief)'}`,
      evenementId: x.evenement_id ?? null,
      link: x.evenement_id ? `/dashboard/evenementen/${x.evenement_id}/sessiegevers` : null,
      datum: x.datum ?? null,
    }));
  },
};

/** Inschrijvingen: het contact (ouder of deelnemer) en het kind, met moment en lesjes. */
export const INSCHRIJVINGEN_BRON: ContactBron = {
  id: 'inschrijvingen',
  extern: true,
  async lees(env) {
    const { results } = await env.DB.prepare(
      `select d.contact_id, d.persoon_id, d.status, d.created_at, e.evenement_id, e.titel,
              (select group_concat(m, ', ') from (select distinct dg.naam || ' ' || lower(dd.naam) as m from inschrijvingen i
                 join evenement_dagen dg on dg.dag_id = i.dag_id join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
                 where i.deelnemer_id = d.deelnemer_id and i.sessie_id is null and i.status <> 'geannuleerd')) as momenten,
              (select group_concat(s.titel, ', ') from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id
                 where i.deelnemer_id = d.deelnemer_id and i.status <> 'geannuleerd') as lesjes
       from deelnemers d join evenementen e on e.evenement_id = d.evenement_id
       where d.contact_id is not null and d.geanonimiseerd_op is null`,
    ).all<any>();
    return results.map((x) => ({
      contactId: x.contact_id,
      persoonId: x.persoon_id,
      soort: 'Inschrijving',
      omschrijving: [x.titel, x.momenten, x.lesjes].filter(Boolean).join(' · ') + (x.status === 'actief' ? '' : ' (geannuleerd of vervangen)'),
      evenementId: x.evenement_id,
      link: `/dashboard/evenementen/${x.evenement_id}/overzicht`,
      datum: x.created_at,
    }));
  },
};

/** Uitnodigingen om in te schrijven (vanuit de voorinschrijvingen). */
export const UITNODIGINGEN_BRON: ContactBron = {
  id: 'uitnodigingen',
  extern: true,
  async lees(env) {
    const STATUS: Record<string, string> = { aangemaakt: 'nog niet verstuurd', verstuurd: 'verstuurd', gebruikt: 'ingeschreven via de link', afgemeld: 'komt niet' };
    const { results } = await env.DB.prepare(
      `select u.contact_id, u.persoon_id, u.status, coalesce(u.laatst_verstuurd_op, u.created_at) as datum, e.evenement_id, e.titel
       from uitnodigingen u join evenementen e on e.evenement_id = u.evenement_id`,
    ).all<any>();
    return results.map((x) => ({
      contactId: x.contact_id,
      persoonId: x.persoon_id,
      soort: 'Uitnodiging',
      omschrijving: `${x.titel}: ${STATUS[x.status] ?? x.status}${x.persoon_id ? '' : ' (voor een ander kind)'}`,
      evenementId: x.evenement_id,
      link: '/dashboard/voorinschrijvingen',
      datum: x.datum,
    }));
  },
};
