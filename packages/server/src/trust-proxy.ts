import proxyaddr from 'proxy-addr';

/**
 * Proxys de confiance (variable TRUST_PROXY), avec la même syntaxe qu’Express :
 * - « loopback » (défaut) : un reverse proxy installé sur la même machine ;
 * - une adresse ou un réseau CIDR, par exemple « 172.16.0.0/12 » pour le réseau Docker ;
 * - une liste séparée par des virgules.
 *
 * Seule une connexion venant d’un proxy de confiance peut indiquer l’adresse réelle du client
 * avec X-Forwarded-For. Sinon, l’adresse du socket fait foi.
 */
export type TrustProxy = (address: string, index: number) => boolean;

/** Compile la configuration. Lève une erreur si une entrée n’est pas une adresse ou un réseau valide. */
export function compileTrustProxy(spec: string): TrustProxy {
  const entries = spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) throw new Error('liste vide');
  return proxyaddr.compile(entries);
}

export { proxyaddr };
