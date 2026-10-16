/**
 * Profils gardés sur cet appareil. Un profil « nom seul » n'a pas de mot de passe : son jeton de session
 * est le seul moyen de le retrouver. Le profil actif est dans `KEY` ; la liste de tous les profils de
 * l'appareil (pour en changer vite) est dans `LIST_KEY`. Toutes les lectures et écritures sont
 * protégées : le stockage peut être indisponible (navigation privée).
 */
const KEY = 'ph:profile';
const LIST_KEY = 'ph:profiles';
/** Événement de la fenêtre : le profil actif ou la liste a changé (les écrans se mettent à jour). */
export const PROFILE_CHANGED = 'ph:profile-changed';

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(PROFILE_CHANGED));
  } catch {
    /* sans fenêtre (tests) : rien à prévenir */
  }
}

/** Un profil connu de cet appareil : son jeton, son identifiant et son pseudo (pour l'affichage). */
export interface DeviceProfile {
  token: string;
  id: string;
  name: string;
}

export function readProfileToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Définit le profil actif par son jeton (sans toucher à la liste). */
export function saveProfileToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Sans stockage, il faudra recréer ou reconnecter le profil à la prochaine visite.
  }
  notifyChanged();
}

/** Plus de profil actif sur cet appareil (la liste reste). */
export function clearProfileToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* sans effet */
  }
  notifyChanged();
}

/** Tous les profils de cet appareil, dans l'ordre où ils ont été créés ou choisis. */
export function readDeviceProfiles(): DeviceProfile[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is DeviceProfile =>
        !!p &&
        typeof (p as DeviceProfile).token === 'string' &&
        typeof (p as DeviceProfile).id === 'string' &&
        typeof (p as DeviceProfile).name === 'string',
    );
  } catch {
    return [];
  }
}

function writeDeviceProfiles(list: DeviceProfile[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* sans effet : la liste ne survivra pas au rechargement */
  }
  notifyChanged();
}

/**
 * Ajoute (ou met à jour) un profil dans la liste de l'appareil. Il devient le profil actif, sauf
 * si `activate` est faux (profil créé pour un autre joueur de l'appareil).
 */
export function rememberDeviceProfile(profile: DeviceProfile, activate = true): void {
  const others = readDeviceProfiles().filter((p) => p.id !== profile.id);
  writeDeviceProfiles([...others, profile]);
  if (activate) saveProfileToken(profile.token);
}

/** Rend actif un profil déjà présent sur cet appareil. */
export function switchDeviceProfile(token: string): void {
  saveProfileToken(token);
}

/** Retire un profil de cet appareil. Si c'était le profil actif, le premier restant devient actif. */
export function forgetDeviceProfile(token: string): void {
  const list = readDeviceProfiles();
  const remaining = list.filter((p) => p.token !== token);
  writeDeviceProfiles(remaining);
  if (readProfileToken() === token) {
    if (remaining[0]) saveProfileToken(remaining[0].token);
    else clearProfileToken();
  }
}

/** Le jeton du profil actif a changé (mot de passe modifié) : la liste suit. */
export function replaceActiveToken(newToken: string): void {
  const old = readProfileToken();
  writeDeviceProfiles(readDeviceProfiles().map((p) => (p.token === old ? { ...p, token: newToken } : p)));
  saveProfileToken(newToken);
}

/** Pseudo affiché dans la liste de l'appareil, après un changement de nom. */
export function renameDeviceProfile(id: string, name: string): void {
  writeDeviceProfiles(readDeviceProfiles().map((p) => (p.id === id ? { ...p, name } : p)));
}

/** Profil actif de cet appareil, s'il figure dans la liste. */
export function activeDeviceProfile(): DeviceProfile | null {
  const token = readProfileToken();
  if (!token) return null;
  return readDeviceProfiles().find((p) => p.token === token) ?? null;
}

/** En-têtes d'authentification pour les appels API du profil. */
export function authHeaders(): Record<string, string> {
  const token = readProfileToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
