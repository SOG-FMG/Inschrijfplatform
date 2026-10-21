-- Wachtwoord als extra stap bij het aanmelden met de authenticator-app (passkeys blijven op zich voldoende:
-- die vragen al het toestel én een pincode/vingerafdruk). PBKDF2-SHA256, zie src/auth/wachtwoord.ts.
alter table gebruikers add column wachtwoord_hash text;

-- Authenticator opnieuw koppelen zonder de huidige meteen ongeldig te maken: eerst bevestigen, dan wisselen.
alter table gebruiker_totp add column nieuw_secret_enc text;

-- Huisstijl per evenement (het logo staat in R2, kolom 'logo' bevat het publieke pad).
alter table evenementen add column kleur_primair text;
alter table evenementen add column kleur_accent  text;
