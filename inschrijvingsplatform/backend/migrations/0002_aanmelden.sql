-- =====================================================================
-- Aanmelden van medewerkers zonder Cloudflare Access / eigen domein:
--   * authenticator-app (TOTP) en/of passkey (WebAuthn: pincode, vingerafdruk, beveiligingssleutel)
--   * sessies in D1; de browser bewaart enkel een willekeurig token in een HttpOnly-cookie
--   * de hoofdadmin staat in wrangler.toml (HOOFDADMIN_EMAIL); die voegt de andere gebruikers toe
-- =====================================================================

-- Eenmalige uitnodigingscode (enkel de hash wordt bewaard) om de eerste keer een tweede factor te koppelen.
alter table gebruikers add column uitnodiging_hash text;
alter table gebruikers add column uitnodiging_tot  text;

create table gebruiker_totp (
  gebruiker_id text primary key references gebruikers(gebruiker_id) on delete cascade,
  secret_enc   text not null,                              -- AES-256-GCM, zelfde sleutel als de persoonsgegevens
  bevestigd    integer not null default 0 check (bevestigd in (0, 1)),
  laatste_stap integer not null default 0,                 -- 30s-tijdstap van de laatst gebruikte code (geen hergebruik)
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table passkeys (
  credential_id text primary key,                          -- base64url
  gebruiker_id  text not null references gebruikers(gebruiker_id) on delete cascade,
  public_key    text not null,                             -- SPKI, base64url
  algoritme     integer not null check (algoritme in (-7, -257)),   -- ES256 of RS256
  teller        integer not null default 0,
  naam          text not null,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  laatst_gebruikt text
);
create index passkeys_gebruiker_idx on passkeys (gebruiker_id);

create table beheer_sessies (
  sessie_hash   text primary key,                          -- SHA-256 van het cookietoken
  gebruiker_id  text not null references gebruikers(gebruiker_id) on delete cascade,
  methode       text not null check (methode in ('totp', 'passkey')),
  aangemaakt_op text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verloopt_op   text not null,
  laatst_gezien text not null,
  ip_adres      text
);
create index beheer_sessies_gebruiker_idx on beheer_sessies (gebruiker_id);

-- Eenmalige uitdagingen voor WebAuthn (5 minuten geldig, verbruikt bij gebruik).
create table aanmeld_uitdagingen (
  uitdaging    text primary key,
  doel         text not null check (doel in ('registratie', 'login')),
  gebruiker_id text references gebruikers(gebruiker_id) on delete cascade,
  verloopt_op  text not null
);

-- Teller tegen gokken: per e-mailadres en per IP-adres.
create table aanmeld_pogingen (
  sleutel       text primary key,
  aantal        integer not null,
  venster_start text not null
);
