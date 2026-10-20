/**
 * Frontend-Worker: serveert de statische bestanden (assets) en stuurt /api/* door naar de API-Worker.
 * Zo draaien frontend en API onder één hostnaam: sessiecookies zijn first-party (SameSite=Strict) en
 * passkeys hebben één vaste rpId. Geen eigen domein nodig.
 */
interface Env {
  API: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.API.fetch(request);
  },
};
