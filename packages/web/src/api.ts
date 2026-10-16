import { describeError, logClient } from './log/clientLog.js';

/** Appels HTTP vers l'API. Les erreurs remontent avec un message lisible en français. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  // Seule la route (sans les paramètres) est journalisée : pas de code de salle ni de jeton.
  const route = path.split('?')[0] ?? path;
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    logClient('error', 'api', `Réseau : ${method} ${route}`, { stack: describeError(err).stack });
    throw new Error('Connexion impossible. Vérifiez le réseau.', { cause: err });
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (res.status >= 500) logClient('error', 'api', `HTTP ${res.status} : ${method} ${route}`);
  if (!res.ok) {
    // Le code HTTP accompagne le message : un 401 veut dire « ce jeton n’est plus valable ».
    const err = new Error(data.error ?? 'Erreur inattendue.') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Identifiant aléatoire pour les commandes.
 * crypto.randomUUID n'existe que dans les contextes sécurisés (HTTPS ou localhost) :
 * il ne faut pas en dépendre sur un réseau local en HTTP.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
