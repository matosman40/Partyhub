/**
 * Jeton de session du profil, gardé sur cet appareil. Toutes les lectures et
 * écritures sont protégées : le stockage peut être indisponible (navigation privée).
 */
const KEY = 'ph:profile';

export function readProfileToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveProfileToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Sans stockage, il faudra se reconnecter à la prochaine visite.
  }
}

export function clearProfileToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* sans effet */
  }
}

/** En-têtes d'authentification pour les appels API du profil. */
export function authHeaders(): Record<string, string> {
  const token = readProfileToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
