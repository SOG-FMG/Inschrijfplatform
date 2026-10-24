// SQL-fragmenten voor capaciteit en wachtlijst. Ze worden ín de schrijfbatch uitgevoerd:
// D1 voert een batch als één transactie uit en verwerkt schrijfopdrachten na elkaar,
// dus tellen en invoegen gebeuren zonder dat een andere inschrijving ertussen komt.
// (Eerst tellen in een aparte query en daarna invoegen zou wél overboeking toelaten.)

/** Status voor een nieuwe sessie-inschrijving; vereist alias `s` voor sessies. 'volzet' → trigger breekt af. */
export const STATUS_SESSIE = `
  case when s.capaciteit is null
         or (select count(*) from inschrijvingen b where b.sessie_id = s.sessie_id and b.status = 'bevestigd') < s.capaciteit
       then 'bevestigd'
       when s.wachtlijst_toegelaten = 1 then 'wachtlijst'
       else 'volzet' end`;

/** Status voor een nieuwe dagdeel-inschrijving; vereist alias `dd` voor dagdelen. */
export const STATUS_DAGDEEL = `
  case when dd.capaciteit is not null
        and (select count(*) from inschrijvingen b
             where b.dagdeel_id = dd.dagdeel_id and b.sessie_id is null and b.status = 'bevestigd') >= dd.capaciteit
       then 'volzet' else 'bevestigd' end`;

/** Schuift de wachtlijst van een sessie op zolang er plaats is (oudste eerst). */
export function promoveerWachtlijst(db: D1Database, sessieId: string): D1PreparedStatement {
  return db
    .prepare(
      `update inschrijvingen set status = 'bevestigd'
       where inschrijving_id in (
         select inschrijving_id from inschrijvingen
         where sessie_id = ?1 and status = 'wachtlijst'
         order by inschrijf_datum, rowid
         -- capaciteit null → max() geeft null → -1 = geen limiet
         limit coalesce((select max(s.capaciteit - (select count(*) from inschrijvingen b
                                                    where b.sessie_id = s.sessie_id and b.status = 'bevestigd'), 0)
                         from sessies s where s.sessie_id = ?1), -1))`,
    )
    .bind(sessieId);
}

export const referentie = (deelnemerId: string) => deelnemerId.replace(/-/g, '').slice(0, 8).toUpperCase();

/** Vandaag in België (YYYY-MM-DD); bepaalt o.a. of annuleren nog kan. */
export const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

export const plaatshouders = (n: number) => Array(n).fill('?').join(', ');
