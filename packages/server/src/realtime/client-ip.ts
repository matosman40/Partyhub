import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { proxyaddr, type TrustProxy } from '../trust-proxy.js';

/**
 * Adresse IP réelle du client pour Socket.IO, calculée exactement comme Express
 * (même bibliothèque, même configuration TRUST_PROXY) : X-Forwarded-For n’est lu que si la
 * connexion arrive d’un proxy de confiance.
 */

/** « ::ffff:1.2.3.4 » devient « 1.2.3.4 » : c’est ainsi qu’un socket IPv6 voit une adresse IPv4. */
export function normalizeIp(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:') && isIP(trimmed.slice(7)) === 4) return trimmed.slice(7);
  return trimmed;
}

export function clientIp(
  trust: TrustProxy,
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
): string {
  if (!remoteAddress) return 'inconnue';
  const remote = normalizeIp(remoteAddress);
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(', ') : forwardedFor;
  const req = {
    headers: header ? { 'x-forwarded-for': header } : {},
    socket: { remoteAddress: remote },
  } as unknown as IncomingMessage;
  try {
    const ip = normalizeIp(proxyaddr(req, trust));
    // Une valeur qui n’est pas une adresse ne doit jamais servir de clé de limitation.
    return isIP(ip) !== 0 ? ip : remote;
  } catch {
    // En-tête illisible : on garde l’adresse du socket, la seule qui ne peut pas être forgée.
    return remote;
  }
}
