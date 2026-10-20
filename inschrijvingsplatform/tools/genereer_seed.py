"""Genereert de seed voor D1 (backend/seed/*.sql) en de demodata van de frontend.

Bron voor de structuur: tabbladen 'selectie D1' / 'selectie D2' en het Google-formulier
van de infodagen 2026. Enkel de scholenlijst wordt uit de Excel gelezen; persoonsgegevens
uit de Excel worden NIET overgenomen.

Gebruik:  python -I tools/genereer_seed.py "pad/naar/Infodagen 2026 (Dag1).xlsx"
"""
import json
import sys
import uuid
from datetime import date, datetime, time, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NS = uuid.UUID("6f1d3c52-6a8e-4c0b-9a51-0c2f3b8e1a77")


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def q(v) -> str:
    """Waarde als SQLite-literal (booleans 0/1, lijsten als JSON-tekst)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return q(json.dumps(v, ensure_ascii=False))
    return "'" + str(v).replace("'", "''") + "'"


def ts(v: str) -> str:
    """Tijdstip met tijdzone. D1 bewaart UTC in hetzelfde formaat als JavaScript (toISOString)."""
    return q(datetime.fromisoformat(v).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))


def in_blokken(rijen: list[str], per: int = 100) -> list[list[str]]:
    """D1 beperkt de grootte van één SQL-instructie: lange inserts opsplitsen."""
    return [rijen[i:i + per] for i in range(0, len(rijen), per)]


# ---------------------------------------------------------------------------
# Stamdata
# ---------------------------------------------------------------------------
ROLLEN = [
    ("platformbeheerder", "Platformbeheerder", "Volledige toegang tot alle scholen en evenementen"),
    ("schoolbeheerder", "Schoolbeheerder", "Beheert alle evenementen van de eigen school"),
    ("organisator", "Organisator", "Beheert de evenementen waaraan hij/zij gekoppeld is"),
    ("onthaal", "Onthaal", "Raadpleegt deelnemerslijsten en registreert aanwezigheid"),
]
SOORTEN = [
    ("Proeflesje", "Korte les voor toekomstige leerlingen"),
    ("Infomoment", "Toelichting voor ouders en leerlingen"),
    ("Rondleiding", "Begeleide rondgang door de school"),
    ("Sessie", "Sessie op een congres of studiedag"),
    ("Workshop", "Interactieve workshop"),
]
FMG = uid("school", "fmg")
LOKALEN = ["Zaal Ami", "Kunstklas", "2A2", "2A3", "2A4", "1A2", "1A3", "1A5", "1A6", "Labo", "Techniek TOP"]

TITELS = {
    "kunst": "Domein Kunst",
    "latijn": "Domein Latijn",
    "wetenschappen": "Domein Wetenschappen",
    "maatschappij": "Domein Maatschappij",
    "engels": "Lesje Engels",
    "frans": "Lesje Frans",
    "geschiedenis": "Lesje Geschiedenis",
    "nederlands": "Nederlands – Escape Room",
    "wiskunde": "Lesje Wiskunde",
    "bstroom": "Proeflesje B-stroom",
}
LOKAAL_D1 = {"kunst": "Kunstklas", "latijn": "2A3", "wetenschappen": "Labo", "engels": "1A5", "frans": "1A3",
             "geschiedenis": "2A4", "nederlands": "2A2", "wiskunde": "1A6", "bstroom": "Techniek TOP"}
LOKAAL_D2 = {"kunst": "Kunstklas", "latijn": "2A3", "maatschappij": "2A2", "wetenschappen": "Labo", "engels": "1A5",
             "frans": "1A6", "geschiedenis": "2A4", "wiskunde": "1A2", "bstroom": "Techniek TOP"}

# Capaciteiten uit 'selectie D1' / 'selectie D2' (0 = niet aangeboden → weggelaten).
# Dag 2 NM keuzelesje 2 was in de bron corrupt; hier aangenomen gelijk aan NM keuzelesje 1 zonder Latijn.
AANBOD = {
    ("d1", "vm", 1): {"kunst": 14, "latijn": 15, "wetenschappen": 14, "geschiedenis": 14, "nederlands": 8, "wiskunde": 14},
    ("d1", "vm", 2): {"kunst": 14, "latijn": 15, "wetenschappen": 16, "engels": 14, "geschiedenis": 14, "nederlands": 14, "wiskunde": 14},
    ("d1", "nm", 1): {"kunst": 14, "latijn": 15, "wetenschappen": 18, "engels": 14, "geschiedenis": 14, "nederlands": 14},
    ("d1", "nm", 2): {"kunst": 14, "wetenschappen": 18, "engels": 14, "frans": 14, "geschiedenis": 14, "wiskunde": 14},
    ("d2", "vm", 1): {"kunst": 14, "maatschappij": 12, "wetenschappen": 14, "geschiedenis": 12, "wiskunde": 12},
    ("d2", "vm", 2): {"kunst": 14, "maatschappij": 12, "wetenschappen": 14, "geschiedenis": 12, "wiskunde": 12},
    ("d2", "nm", 1): {"kunst": 14, "latijn": 10, "maatschappij": 12, "wetenschappen": 14, "geschiedenis": 12, "wiskunde": 12},
    ("d2", "nm", 2): {"kunst": 14, "maatschappij": 12, "wetenschappen": 14, "geschiedenis": 12, "wiskunde": 12},
}

EVENEMENT = uid("evenement", "fmg-infodagen-2027")
SLUG = "fmg-infodagen-2027"
DOELGROEPEN = [
    (uid("dg", "a"), "A-stroom", "Leerlingen met getuigschrift lager onderwijs", True, 1),
    (uid("dg", "b"), "B-stroom", "Hoofdzakelijk leerlingen zonder getuigschrift lager onderwijs", True, 2),
]
# Voorbeelddata voor de volgende editie (zaterdagen). Pas aan in de beheeromgeving.
DAGEN = [
    ("d1", "Zaterdag 23 januari", date(2027, 1, 23), "2027-01-21T23:59:00+01:00", LOKAAL_D1),
    ("d2", "Zaterdag 6 maart", date(2027, 3, 6), "2027-03-04T23:59:00+01:00", LOKAAL_D2),
]
DAGDELEN = [("vm", "Voormiddag", time(10, 0), time(12, 10), 0), ("nm", "Namiddag", time(13, 0), time(15, 10), 3)]
PRIVACY = (
    "[CONCEPT – te valideren door de DPO] De Freinetmiddenschool Gent (Stedelijk Onderwijs Gent) verwerkt deze "
    "gegevens enkel om je inschrijving voor de infodag te organiseren: groepen samenstellen, je een bevestiging en "
    "praktische info mailen en je contacteren bij wijzigingen. Enkel de organiserende medewerkers hebben toegang. "
    "Uiterlijk 30 dagen na de laatste infodag worden namen en contactgegevens verwijderd; enkel anonieme statistieken "
    "(herkomstschool, gemeente, leerjaar) blijven bewaard. Je kan je inschrijving zelf inkijken en annuleren via de "
    "link in je bevestigingsmail, en je hebt recht op inzage, verbetering en verwijdering."
)


def t(h: int, m: int) -> time:
    return time(h, m)


def plus(tm: time, minuten: int) -> time:
    tot = tm.hour * 60 + tm.minute + minuten
    return time(tot // 60, tot % 60)


def bouw_structuur():
    """Geeft de dagen terug als geneste dicts (zelfde vorm voor SQL en demo)."""
    dagen = []
    for di, (dk, dnaam, datum, keuze_tot, lokalen) in enumerate(DAGEN, start=1):
        dagdelen = []
        for ddi, (dpk, dpnaam, start, eind, _) in enumerate(DAGDELEN, start=1):
            blokken = [
                ("onthaal", "Onthaal", "Verwelkoming in de inkomhal", start, plus(start, 10), "programma"),
                ("k1", "Keuzelesje 1", "Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg",
                 plus(start, 10), plus(start, 50), "keuze"),
                ("rondleiding", "Rondleiding", "Samen met je ouder(s) door de school", plus(start, 50), plus(start, 90), "programma"),
                ("k2", "Keuzelesje 2", "Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg",
                 plus(start, 90), eind, "keuze"),
            ]
            tijdsblokken = []
            for ti, (tk, tnaam, tomschr, ts, te, ttype) in enumerate(blokken, start=1):
                sessies = []
                if ttype == "keuze":
                    nr = 1 if tk == "k1" else 2
                    for si, (code, cap) in enumerate(AANBOD[(dk, dpk, nr)].items(), start=1):
                        sessies.append(dict(id=uid("s", dk, dpk, tk, code), code=code, titel=TITELS[code],
                                            soort="Proeflesje", doelgroep=DOELGROEPEN[0][0], locatie=lokalen[code],
                                            capaciteit=cap, uniek=True, volgorde=si))
                    sessies.append(dict(id=uid("s", dk, dpk, tk, "bstroom"), code="bstroom", titel=TITELS["bstroom"],
                                        soort="Proeflesje", doelgroep=DOELGROEPEN[1][0], locatie=lokalen["bstroom"],
                                        capaciteit=12, uniek=False, volgorde=50,
                                        beschrijving="Praktijkgericht proeflesje in de technieklokalen"))
                    sessies.append(dict(id=uid("s", dk, dpk, tk, "infomoment"), code="infomoment",
                                        titel="Infomoment samen met je ouder(s)", soort="Infomoment", doelgroep=None,
                                        locatie="Zaal Ami", capaciteit=None, uniek=False, volgorde=99,
                                        beschrijving="Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie"))
                tijdsblokken.append(dict(id=uid("t", dk, dpk, tk), naam=tnaam, omschrijving=tomschr, start=ts, eind=te,
                                         type=ttype, verplicht=False, volgorde=ti, sessies=sessies))
            dagdelen.append(dict(id=uid("dd", dk, dpk), naam=dpnaam, start=start, eind=eind, volgorde=ddi,
                                 capaciteit=None, tijdsblokken=tijdsblokken))
        dagen.append(dict(id=uid("dag", dk), naam=dnaam, datum=datum, keuze_tot=keuze_tot, volgorde=di, dagdelen=dagdelen))
    return dagen


def lees_scholen(xlsx: Path):
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["Scholen"]
    scholen = {}
    for r in ws.iter_rows(min_row=2, max_col=6, values_only=True):
        nummer, _, net, naam, postcode, gemeente = r
        if not isinstance(nummer, int) or not naam:
            continue
        scholen[nummer] = dict(id=uid("school", str(nummer)), nummer=nummer, net=str(net or "").strip(),
                               naam=" ".join(str(naam).split()), postcode=str(postcode or "").strip(),
                               gemeente=str(gemeente or "").strip())
    return sorted(scholen.values(), key=lambda s: s["naam"].lower())


def seed_sql(dagen) -> str:
    out = ["-- Gegenereerd door tools/genereer_seed.py – niet manueel aanpassen.",
           "-- Voorbeeldevenement op basis van de infodagen 2026 van de Freinetmiddenschool Gent.", ""]
    out.append("insert into rollen (rol_id, code, naam, beschrijving) values")
    out.append(",\n".join(f"  ({q(uid('rol', c))}, {q(c)}, {q(n)}, {q(b)})" for c, n, b in ROLLEN) + ";\n")
    out.append("insert into soorten_onderdelen (soort_id, naam, beschrijving) values")
    out.append(",\n".join(f"  ({q(uid('soort', n))}, {q(n)}, {q(b)})" for n, b in SOORTEN) + ";\n")
    out.append("insert into scholen (school_id, naam, onderwijsnet, postcode, gemeente) values")
    out.append(f"  ({q(FMG)}, 'Freinetmiddenschool Gent', 'Officieel gesubsidieerd onderwijs', '9000', 'Gent');\n")
    out.append("insert into locaties (locatie_id, school_id, naam, lokaal) values")
    out.append(",\n".join(f"  ({q(uid('loc', l))}, {q(FMG)}, {q(l)}, {q(l)})" for l in LOKALEN) + ";\n")

    out.append("insert into evenementen (evenement_id, slug, titel, omschrijving, type_evenement, organisator, school_id,")
    out.append("  start_datum, eind_datum, status, inschrijving_tot, deelnemer_type, leerjaar_opties, max_dagdelen,")
    out.append("  contact_email, privacy_tekst, bewaartermijn_dagen) values")
    out.append(f"  ({q(EVENEMENT)}, {q(SLUG)}, 'Infodagen 2027', "
               f"{q('Kom kennismaken met onze school! Kies een datum en een dagdeel en schrijf je in voor één of twee proeflesjes. Kom je liever gewoon eens kijken? Kies dan ‘geen proeflesje’.')}, "
               f"'Infodag', 'Freinetmiddenschool Gent', {q(FMG)},\n"
               f"   '2027-01-23', '2027-03-06', 'gepubliceerd', {ts('2027-03-04T23:59:00+01:00')}, 'leerling', "
               f"{q(['4de leerjaar', '5de leerjaar', '6de leerjaar', 'Andere'])}, 1,\n"
               f"   'infodag@freinetmiddenschool.example', {q(PRIVACY)}, 30);\n")

    out.append("insert into doelgroepen (doelgroep_id, evenement_id, naam, beschrijving, sessiekeuze, volgorde) values")
    out.append(",\n".join(f"  ({q(i)}, {q(EVENEMENT)}, {q(n)}, {q(b)}, {q(s)}, {v})" for i, n, b, s, v in DOELGROEPEN) + ";\n")

    for dag in dagen:
        out.append("insert into evenement_dagen (dag_id, evenement_id, naam, datum, start_uur, eind_uur, volgorde, sessiekeuze_tot) values")
        out.append(f"  ({q(dag['id'])}, {q(EVENEMENT)}, {q(dag['naam'])}, '{dag['datum']}', '10:00', '15:10', {dag['volgorde']}, {ts(dag['keuze_tot'])});")
        for dd in dag["dagdelen"]:
            out.append("insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde, capaciteit) values")
            out.append(f"  ({q(dd['id'])}, {q(dag['id'])}, {q(dd['naam'])}, '{dd['start']:%H:%M}', '{dd['eind']:%H:%M}', {dd['volgorde']}, {q(dd['capaciteit'])});")
            out.append("insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht) values")
            out.append(",\n".join(
                f"  ({q(tb['id'])}, {q(dd['id'])}, {q(tb['naam'])}, {q(tb['omschrijving'])}, '{tb['start']:%H:%M}', '{tb['eind']:%H:%M}', {tb['volgorde']}, {q(tb['type'])}, {q(tb['verplicht'])})"
                for tb in dd["tijdsblokken"]) + ";")
            rijen = [
                f"  ({q(s['id'])}, {q(tb['id'])}, {q(uid('soort', s['soort']))}, {q(s['doelgroep'])}, {q(s['code'])}, {q(s['titel'])}, "
                f"{q(s.get('beschrijving'))}, {q(uid('loc', s['locatie']))}, {q(s['capaciteit'])}, {q(s['uniek'])}, {s['volgorde']})"
                for tb in dd["tijdsblokken"] for s in tb["sessies"]]
            out.append("insert into sessies (sessie_id, tijdsblok_id, soort_id, doelgroep_id, code, titel, beschrijving, locatie_id, capaciteit, uniek_per_deelnemer, volgorde) values")
            out.append(",\n".join(rijen) + ";\n")
    return "\n".join(out)


def scholen_sql(scholen) -> str:
    out = ["-- Gegenereerd door tools/genereer_seed.py uit het tabblad 'Scholen' (officiële scholenlijst)."]
    rijen = [f"  ({q(s['id'])}, {s['nummer']}, {q(s['naam'])}, {q(s['net'])}, {q(s['postcode'])}, {q(s['gemeente'])})"
             for s in scholen]
    for blok in in_blokken(rijen):
        out.append("insert into scholen (school_id, instellingsnummer, naam, onderwijsnet, postcode, gemeente) values")
        out.append(",\n".join(blok) + "\non conflict (instellingsnummer) do update set naam = excluded.naam,"
                   " onderwijsnet = excluded.onderwijsnet, postcode = excluded.postcode, gemeente = excluded.gemeente;")
    return "\n".join(out) + "\n"


def demo_json(dagen) -> dict:
    """Zelfde vorm als publiek_evenement() in de database."""
    return {
        "evenementId": EVENEMENT, "slug": SLUG, "titel": "Infodagen 2027",
        "omschrijving": "Kom kennismaken met onze school! Kies een datum en een dagdeel en schrijf je in voor één of twee "
                        "proeflesjes. Kom je liever gewoon eens kijken? Kies dan ‘geen proeflesje’.",
        "typeEvenement": "Infodag", "organisator": "Freinetmiddenschool Gent", "deelnemerType": "leerling",
        "leerjaarOpties": ["4de leerjaar", "5de leerjaar", "6de leerjaar", "Andere"], "maxDagdelen": 1,
        "contactEmail": "infodag@freinetmiddenschool.example", "privacyTekst": PRIVACY, "bewaartermijnDagen": 30,
        "logo": None, "afbeelding": None, "inschrijvingVanaf": None, "inschrijvingTot": "2027-03-04T23:59:00+01:00",
        "inschrijvingOpen": True,
        "doelgroepen": [dict(id=i, naam=n, beschrijving=b, sessiekeuze=s) for i, n, b, s, _ in DOELGROEPEN],
        "dagen": [dict(
            id=d["id"], naam=d["naam"], datum=str(d["datum"]), sessiekeuzeOpen=True,
            dagdelen=[dict(
                id=dd["id"], naam=dd["naam"], startUur=f"{dd['start']:%H:%M}", eindUur=f"{dd['eind']:%H:%M}",
                capaciteit=dd["capaciteit"], vrij=None,
                tijdsblokken=[dict(
                    id=tb["id"], naam=tb["naam"], omschrijving=tb["omschrijving"], startUur=f"{tb['start']:%H:%M}",
                    eindUur=f"{tb['eind']:%H:%M}", type=tb["type"], verplicht=tb["verplicht"],
                    sessies=[dict(id=s["id"], code=s["code"], titel=s["titel"], beschrijving=s.get("beschrijving"),
                                  soort=s["soort"], doelgroepId=s["doelgroep"], locatie=s["locatie"], kleur=None,
                                  capaciteit=s["capaciteit"], vrij=s["capaciteit"], volzet=False, wachtlijst=False,
                                  uniek=s["uniek"]) for s in tb["sessies"]])
                    for tb in dd["tijdsblokken"]])
                for dd in d["dagdelen"]])
            for d in dagen],
    }


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    dagen = bouw_structuur()
    scholen = lees_scholen(Path(sys.argv[1]))
    seed = ROOT / "backend" / "seed"
    seed.mkdir(exist_ok=True)
    (seed / "seed.sql").write_text(seed_sql(dagen), encoding="utf-8")
    (seed / "seed_scholen.sql").write_text(scholen_sql(scholen), encoding="utf-8")
    demo = ROOT / "frontend" / "src" / "demo"
    demo.mkdir(exist_ok=True)
    (demo / "evenement.json").write_text(json.dumps(demo_json(dagen), ensure_ascii=False, indent=1), encoding="utf-8")
    (demo / "scholen.json").write_text(json.dumps(
        [dict(id=s["id"], naam=s["naam"], gemeente=s["gemeente"]) for s in scholen], ensure_ascii=False), encoding="utf-8")
    print(f"OK: {sum(len(tb['sessies']) for d in dagen for dd in d['dagdelen'] for tb in dd['tijdsblokken'])} sessies, "
          f"{len(scholen)} scholen")


if __name__ == "__main__":
    main()
