/**
 * Kleuren van een evenement toepassen op het formulier. De stijlen gebruiken overal --primair e.d.,
 * dus het volstaat die variabelen op <html> te zetten. Lege kleur = de standaard uit styles.css.
 */
export function zetHuisstijl(primair: string | null | undefined, accent: string | null | undefined) {
  const stijl = document.documentElement.style;
  const geldig = (k: string | null | undefined) => (k && /^#[0-9a-f]{6}$/i.test(k) ? k : null);
  const p = geldig(primair);
  const a = geldig(accent);
  if (p) {
    stijl.setProperty('--primair', p);
    stijl.setProperty('--primair-donker', `color-mix(in srgb, ${p} 78%, black)`);
    stijl.setProperty('--primair-licht', `color-mix(in srgb, ${p} 12%, var(--vlak))`);
  } else {
    for (const v of ['--primair', '--primair-donker', '--primair-licht']) stijl.removeProperty(v);
  }
  if (a) stijl.setProperty('--focus', a);
  else stijl.removeProperty('--focus');
}

/** Icoontje in het browsertabblad (favicon) van het evenement zetten, of terug weghalen zonder pictogram. */
export function zetIcoon(pad: string | null | undefined) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!pad) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = pad;
}
