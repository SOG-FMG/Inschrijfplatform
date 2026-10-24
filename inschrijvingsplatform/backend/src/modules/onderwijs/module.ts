import { scholen } from '../../db/evenement';
import { json } from '../../kern/http';
import { defineModule } from '../../kern/module';

/**
 * Onderwijs: de scholenlijst voor het inschrijfformulier. Leerlingen met ouder als contact, het leerjaar,
 * de schoolbeheerder en de klaslijsten zitten nog in evenementen en rapporten; ze verhuizen naar hier in fase 3.
 */
export default defineModule({
  id: 'onderwijs',
  naam: 'Onderwijs',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['evenementen'],

  routes: [
    {
      methode: 'GET',
      pad: '/scholen',
      toegang: 'publiek',
      handler: async ({ env }) => json(await scholen(env), 200, { 'Cache-Control': 'public, max-age=3600' }),
    },
  ],
});
