/** Appels HTTP vers l'API. Les erreurs remontent avec un message lisible en français. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error('Connexion impossible. Vérifiez le réseau.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error ?? 'Erreur inattendue.');
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
