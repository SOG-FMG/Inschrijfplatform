import { ApiFout } from '../types';
import { beheerApi } from './beheerApi';

/** WebAuthn in de browser: pincode, vingerafdruk, gezichtsherkenning of een beveiligingssleutel. */

const naarB64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vanB64u = (s: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return bytes.buffer;
};

export const passkeysBeschikbaar = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

/** Vertaalt het annuleren of falen van het systeemvenster naar een begrijpelijke melding. */
function vertaal(e: unknown): ApiFout {
  if (e instanceof ApiFout) return e;
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
    return new ApiFout('GEANNULEERD', 'Geannuleerd of verlopen. Probeer opnieuw.');
  }
  if (e instanceof DOMException && e.name === 'InvalidStateError') {
    return new ApiFout('BESTAAT', 'Deze passkey is al geregistreerd op dit toestel.');
  }
  return new ApiFout('PASSKEY', 'Passkey gebruiken is mislukt op dit toestel.');
}

export async function meldAanMetPasskey(): Promise<void> {
  try {
    const o = await beheerApi.passkeyLoginOpties();
    const cred = (await navigator.credentials.get({
      publicKey: { challenge: vanB64u(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: o.timeout },
    })) as PublicKeyCredential | null;
    if (!cred) throw new ApiFout('GEANNULEERD', 'Geannuleerd.');
    const r = cred.response as AuthenticatorAssertionResponse;
    await beheerApi.passkeyLogin({
      id: cred.id,
      clientDataJSON: naarB64u(r.clientDataJSON),
      authenticatorData: naarB64u(r.authenticatorData),
      handtekening: naarB64u(r.signature),
    });
  } catch (e) {
    throw vertaal(e);
  }
}

export async function registreerPasskey(naam: string): Promise<void> {
  try {
    const o = await beheerApi.passkeyRegistratieOpties();
    const cred = (await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: vanB64u(o.challenge),
        user: { ...o.user, id: vanB64u(o.user.id) },
        excludeCredentials: o.excludeCredentials.map((c: { type: 'public-key'; id: string }) => ({ ...c, id: vanB64u(c.id) })),
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new ApiFout('GEANNULEERD', 'Geannuleerd.');
    const r = cred.response as AuthenticatorAttestationResponse;
    const publicKey = r.getPublicKey?.();
    const algoritme = r.getPublicKeyAlgorithm?.();
    const authData = r.getAuthenticatorData?.();
    if (!publicKey || algoritme === undefined || !authData) {
      throw new ApiFout('PASSKEY', 'Deze browser is te oud voor passkeys. Update je browser.');
    }
    await beheerApi.passkeyOpslaan({
      id: cred.id,
      clientDataJSON: naarB64u(r.clientDataJSON),
      authenticatorData: naarB64u(authData),
      publicKey: naarB64u(publicKey),
      algoritme,
      naam,
    });
  } catch (e) {
    throw vertaal(e);
  }
}
