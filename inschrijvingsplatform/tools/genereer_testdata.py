"""Maakt VERZONNEN voorinschrijvingen in het formaat van een Microsoft Forms-export (CSV), om de import te testen.

Gebruik:  python -I tools/genereer_testdata.py
Resultaat: tools/testdata/voorinschrijvingen_2024-2025_verzonnen.csv en ..._2025-2026_verzonnen.csv

Alle namen, e-mailadressen (@example.org, gereserveerd voor tests) en telefoonnummers zijn verzonnen.
Schoolnamen zijn echte namen uit de officiële lijst, zoals ouders ze zouden typen (met en zonder gemeente,
afkortingen, tikfouten), zodat het koppelen van scholen realistisch getest wordt.

Testgevallen in de bestanden:
  - broers en zussen: zelfde e-mailadres, ander kind            -> één gezin, twee kinderen
  - zelfde kind twee keer (andere hoofdletters/woordvolgorde)  -> herkend als hetzelfde kind
  - tikfout in de naam van een gekend kind                      -> twijfel: jij kiest
  - geen geldig e-mailadres ("anonymous", leeg)                 -> wordt niet aan een gezin gekoppeld
  - scholen: zeker, twijfel (algemene naam), niet in de lijst, leeg
  - overlap tussen de twee schooljaren: hetzelfde kind (5de -> 6de leerjaar) en een jongere broer of zus
  - onzichtbare tekens achter kolomnamen en antwoorden, lege rijen onderaan (zoals Forms)
"""
import os

HIER = os.path.dirname(os.path.abspath(__file__))
UIT = os.path.join(HIER, 'testdata')
KAPOT = '�'  # het teken dat Forms achter sommige kolomnamen en antwoorden zet

KOP = ['ID', 'Begintijd', 'Tijd van voltooien', 'E-mail', 'Naam', 'Tijd van laatste wijziging', 'Naam + Voornaam kind',
       f'Informatie gewenst voor{KAPOT}', 'Huidige school', 'Huidige klas', f'Mailadres{KAPOT}', f'Telefoonnummer{KAPOT}',
       'Specifieke vragen of opmerkingen?']

# (naam kind zoals de ouder het typte, e-mail, telefoon, school zoals getypt, klas, opmerking)
DIT_JAAR = [
    ('Peeters Lotte', 'fam.peeters@example.org', '0400 11 22 01', 'De Bellewij Lebbeke', '6de leerjaar', ''),
    ('Peeters Lars', 'fam.peeters@example.org', '0400 11 22 01', 'De Bellewij Lebbeke', '6de leerjaar', 'Tweeling, graag in dezelfde klas'),
    ('Janssens Mila', 'an.janssens@example.org', '0400 11 22 02', 'VBS Sterreneiland', '6de leerjaar', 'Nee'),
    ('Maes Noor', 'maes.gezin@example.org', '0400 11 22 03', 'de vlinderboom zele', '6de leerjaar', 'Hoe zit het met de busverbinding?'),
    ('Jacobs Finn', 'jacobs@example.org', '', 'Dokata', '6de leerjaar', ''),
    ('Willems Ella', 'ellawillems.ouders@example.org', '0400 11 22 05', 'GO! Leefschool Heyerdahl Sint-Niklaas', '6de leerjaar', ''),
    ('Mertens Jules', 'mertens.fam@example.org', '0400 11 22 06', 'Gemeentelijke basisschool Lievegem', '6de leerjaar', ''),
    ('Claes Lina', 'claes@example.org', '0400 11 22 07', 'De Plataan (Destelbergen)', '6de leerjaar', 'Graag info over zorg'),
    ('Wouters Mats', 'wouters.m@example.org', '0400 11 22 08', 'Kraaiennest Dendermonde', '5de leerjaar', 'Info voor volgend jaar'),
    ('Goossens Amira', 'goossens@example.org', '0400 11 22 09', 'HEHA school Dendermonde', '6de leerjaar', ''),
    ('De Smet Lucas', 'desmet@example.org', '0400 11 22 10', 'Windwijzer', '6de leerjaar', ''),
    ('Van den Broeck Fien', 'vdbroeck@example.org', '0400 11 22 11', 'Pius X Zele', '6de leerjaar', 'Krijgen broers en zussen voorrang?'),
    ('Dubois Sam', 'dubois@example.org', '0400 11 22 12', 'Atheneum Brugge', '6de leerjaar', 'We verhuizen naar Gent'),
    ('Hermans Yara', 'hermans@example.org', '0400 11 22 13', 'Stedelijke basisschool Ninove', '6de leerjaar', ''),
    ('Lambrecht Kobe', 'lambrecht@example.org', '0400 11 22 14', '', '6de leerjaar', ''),
    ('Verhoeven Zoë', 'verhoeven@example.org', '0400 11 22 15', 'thuisonderwijs', 'Andere', 'Thuisonderwijs, kan dat?'),
    # zelfde kind twee keer (andere woordvolgorde en hoofdletters): herkend als hetzelfde kind
    ('janssens mila', 'An.Janssens@example.org', '0400 11 22 02', 'Sterreneiland Lede', '6de leerjaar', 'Tweede keer ingevuld'),
    ('Mila Janssens', 'an.janssens@example.org', '', 'VBS Sterreneiland', '6de leerjaar', ''),
    # tikfout in de naam van een gekend kind: twijfel
    ('Peeters Lote', 'fam.peeters@example.org', '0400 11 22 01', 'De Bellewij', '6de leerjaar', ''),
    # zonder geldig e-mailadres
    ('Bogaert Emma', 'anonymous', '', 'Dokata Gent', '6de leerjaar', ''),
    ('Segers Tibo', '', '0400 11 22 20', 'De Plataan', '6de leerjaar', ''),
    # nieuw dit jaar: jongere broer van een leerling van vorig jaar
    ('Coppens Vic', 'coppens@example.org', '0400 11 22 21', 'Gemeentelijke Basisschool De Windwijzer Laarne', '6de leerjaar', 'Zus Nina zit al bij jullie'),
    # zelfde kind als vorig jaar (toen 5de, nu 6de leerjaar): komt graag een tweede keer
    ('Wouters Mats', 'wouters.m@example.org', '0400 11 22 08', 'Kraaiennest Dendermonde', '6de leerjaar', 'Vorig jaar al eens geweest'),
]

VORIG_JAAR = [
    ('Coppens Nina', 'coppens@example.org', '0400 11 22 21', 'De Windwijzer Laarne', '6de leerjaar', ''),
    ('Wouters Mats', 'wouters.m@example.org', '0400 11 22 08', 'Kraaiennest', '5de leerjaar', 'Al eens komen kijken'),
    ('Aerts Liam', 'aerts@example.org', '0400 11 22 30', 'De Bellewij Lebbeke', '6de leerjaar', ''),
    ('Michiels Lou', 'michiels@example.org', '0400 11 22 31', 'Dokata', '6de leerjaar', ''),
    ('Michiels Rosa', 'michiels@example.org', '0400 11 22 31', 'Dokata', '6de leerjaar', 'Tweeling'),
    ('Pauwels Ines', 'pauwels@example.org', '', 'Vlinderboom', '6de leerjaar', ''),
    ('Hendrickx Arne', 'hendrickx@example.org', '0400 11 22 33', 'Atheneum Brugge', '6de leerjaar', ''),
    ('Leclercq Julie', 'anonymous', '', 'Pius X', '6de leerjaar', ''),
]


def datum(jaar, i, extra_minuten=0):
    # dag/maand/jaar zoals een Belgisch Forms-account; dag 13+ komt voor, zodat de import het formaat herkent
    dag = 3 + (i * 5) % 26
    maand = 3 + (i // 6) % 3
    uur = 9 + (i * 3) % 12
    minuut = (i * 7) % 50 + extra_minuten
    return f'{dag}/{maand}/{str(jaar)[2:]} {uur}:{minuut:02d}:{(i * 13) % 60:02d}'


def veld(v):
    v = str(v)
    return f'"{v.replace(chr(34), chr(34) * 2)}"' if any(c in v for c in ';"\n') else v


def schrijf(naam, rijen, jaar, schooljaar):
    os.makedirs(UIT, exist_ok=True)
    regels = [';'.join(KOP)]
    for i, (kind, mail, tel, school, klas, opm) in enumerate(rijen, start=1):
        begin = datum(jaar, i)
        eind = datum(jaar, i, extra_minuten=1 + i % 4)
        regels.append(';'.join(veld(x) for x in [
            i, begin, eind, 'anonymous', '', '', kind, schooljaar, school, klas + KAPOT, mail, tel, opm,
        ]))
    regels += [';' * (len(KOP) - 1)] * 20  # lege rijen onderaan, zoals in de export
    pad = os.path.join(UIT, naam)
    with open(pad, 'w', encoding='utf-8-sig', newline='') as f:
        f.write('\r\n'.join(regels) + '\r\n')
    print(f'{pad}: {len(rijen)} rijen')


schrijf('voorinschrijvingen_2025-2026_verzonnen.csv', DIT_JAAR, 2025, 'Schooljaar 2026 - 2027')
schrijf('voorinschrijvingen_2024-2025_verzonnen.csv', VORIG_JAAR, 2024, 'Schooljaar 2025 - 2026')
