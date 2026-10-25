import type { ContactBron } from './module';

/** Medewerkers in de contactenlijst: hun rol, en de evenementen waaraan ze gekoppeld zijn. */

const ROLNAAM: Record<string, string> = {
  platformbeheerder: 'Platformbeheerder',
  schoolbeheerder: 'Schoolbeheerder',
  organisator: 'Organisator',
  onthaal: 'Onthaal',
};

export const MEDEWERKERS_BRON: ContactBron = {
  id: 'medewerkers',
  extern: false,
  async lees(env) {
    const [gebruikers, koppelingen] = await env.DB.batch<any>([
      env.DB.prepare(`select g.email, g.voornaam, g.naam, g.actief, r.code as rol from gebruikers g join rollen r on r.rol_id = g.rol_id`),
      env.DB.prepare(
        `select g.email, g.voornaam, g.naam, b.rol, e.evenement_id, e.titel from evenement_beheerders b
         join gebruikers g on g.gebruiker_id = b.gebruiker_id join evenementen e on e.evenement_id = b.evenement_id`,
      ),
    ]);
    const naam = (x: any) => `${x.voornaam} ${x.naam}`.trim();
    return [
      ...(gebruikers.results as any[]).map((x) => ({
        email: x.email,
        naam: naam(x),
        soort: 'Medewerker',
        omschrijving: `${ROLNAAM[x.rol] ?? x.rol}${x.actief ? '' : ' (gedeactiveerd)'}`,
        link: '/dashboard/medewerkers',
      })),
      ...(koppelingen.results as any[]).map((x) => ({
        email: x.email,
        naam: naam(x),
        soort: 'Medewerker',
        omschrijving: `${x.rol === 'onthaal' ? 'Onthaal' : 'Organisator'} van ${x.titel}`,
        evenementId: x.evenement_id,
        link: `/dashboard/evenementen/${x.evenement_id}`,
      })),
    ];
  },
};
