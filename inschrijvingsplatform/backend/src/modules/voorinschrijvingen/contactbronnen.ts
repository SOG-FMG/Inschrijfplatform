import type { ContactBron } from '../../kern/module';
import { heeftRecht } from '../../kern/toegang';

/**
 * Voorinschrijvingen in de contactenlijst. Een import zonder evenement hoort bij niemands evenement: die zie je enkel
 * met het recht voorinschrijvingen.beheren.
 */
export const VOORINSCHRIJVINGEN_BRON: ContactBron = {
  id: 'voorinschrijvingen',
  extern: true,
  async lees(env, { gebruiker }) {
    const { results } = await env.DB.prepare(
      `select v.contact_id, v.persoon_id, v.ingediend_op, v.klas, i.naam, coalesce(i.evenement_id, f.evenement_id) as evenement_id
       from voorinschrijvingen v join voorinschrijvingen_importen i on i.import_id = v.import_id
       left join voorinschrijvingen_formulieren f on f.import_id = v.import_id
       where v.contact_id is not null`,
    ).all<any>();
    const alles = heeftRecht(gebruiker, 'voorinschrijvingen.beheren');
    return results
      .filter((x) => x.evenement_id || alles)
      .map((x) => ({
        contactId: x.contact_id,
        persoonId: x.persoon_id,
        soort: 'Voorinschrijving',
        omschrijving: [x.naam, x.klas].filter(Boolean).join(' · '),
        evenementId: x.evenement_id,
        link: x.evenement_id ? `/dashboard/evenementen/${x.evenement_id}/overzicht` : '/dashboard/voorinschrijvingen',
        datum: x.ingediend_op,
      }));
  },
};
