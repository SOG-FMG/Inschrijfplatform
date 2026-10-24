import kern from '../kern/kernmodule';
import type { Module } from '../kern/module';
import etiketten from './etiketten/module';
import evenementen from './evenementen/module';
import meldingen from './meldingen/module';
import onderwijs from './onderwijs/module';
import rapporten from './rapporten/module';

/**
 * Alle modules die in deze code zitten. Welke er actief zijn, bepaalt MODULES per installatie (wrangler.toml).
 * Een nieuwe module: map onder src/modules/<id>/ met een module.ts, en hier toevoegen.
 * Bij dezelfde route wint de module die hier eerst staat; het register weigert dubbele routes.
 */
export const ALLE_MODULES: Module[] = [kern, evenementen, onderwijs, rapporten, etiketten, meldingen];
