# Instructie: UI-aanpassingen inschrijfplatform (fmg-inschrijfplatform)

## Context

Inschrijfplatform voor Freinetmiddenschool Gent, gehost op Cloudflare Workers. Twee visuele problemen op basis van screenshots uit productie.

---

## Taak 1 — Algemene schaal 20% kleiner

**Probleem:** lettertype, knoppen en invoervelden ogen te groot in de hele UI.

**Uitzondering:** de tekst in de autocomplete-suggesties (bv. "Stedelijke Basisschool - Victor Carpentier") heeft wél de juiste grootte. Niet aanraken.

### Aanpak

1. Zoek de centrale schaalbron:
   - root `font-size` op `html`/`body`
   - CSS custom properties / design tokens (`--font-size-*`, `--spacing-*`)
   - Tailwind-config (`theme.fontSize`, `theme.spacing`) indien van toepassing
2. Vermenigvuldig de relevante waarden met **0,8** (bv. 16px → ~13px, 1rem-gebaseerde spacing idem).
3. Als er geen centrale variabele bestaat: pas het expliciet toe op de classes/componenten van labels, inputs, buttons en headings.
4. **Sluit expliciet uit:** de component/class van de autocomplete-suggestielijst (schoolzoekveld en gelijkaardige dropdowns) — die behoudt zijn huidige font-size.
5. Controleer nadien visueel dat verhoudingen (padding, border-radius, icon-grootte) proportioneel meeschalen, niet enkel de tekst.

---

## Taak 2 — Schoolzoekveld: volledige naam zichtbaar + echte dropdown

**Probleem:** gevonden schoolnaam wordt afgekapt met "…" (bv. "Stedelijke Basisschool - Victor Carpentier…"), onvoldoende leesbaar.

**Gewenst resultaat:**

1. Volledige schoolnaam leesbaar, geen afkapping.
2. Tekst mag over meerdere regels lopen indien nodig.
3. Container/dropdown breed genoeg, of tekst laten doorlopen naar een tweede regel.
4. Visueel een echte dropdown: subtiele schaduw, afgeronde hoeken, en een open/sluit-animatie (slide-down) in plaats van abrupt verschijnen/verdwijnen.
5. Controleer dat geen bovenliggende `overflow: hidden` de lijst alsnog afkapt.

### Technische hints

- CSS op de suggestie-items: verwijder `text-overflow: ellipsis`, `white-space: nowrap`; vervang door `white-space: normal` + `overflow-wrap: break-word`.
- Dropdown-animatie: transitie op `max-height` + `opacity`, of `transform: scaleY()` vanuit de top, gekoppeld aan de open/close-state van het component.
- Controleer `z-index` en `overflow` van alle bovenliggende containers tot aan de root van het formulier.

---

## Opleverchecklist

- [ ] Lettertype, knoppen, velden ~20% kleiner over de hele site
- [ ] Autocomplete-suggestietekst ongewijzigd qua grootte
- [ ] Volledige schoolnaam zichtbaar in de suggestielijst, geen "…"
- [ ] Suggestielijst opent met een merkbare slide-down animatie
- [ ] Niets wordt afgekapt door overflow van een bovenliggend element
- [ ] Visuele check op minstens 2 schermbreedtes (desktop + mobiel)
