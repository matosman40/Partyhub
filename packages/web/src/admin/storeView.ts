/**
 * Logique pure du magasin (administration) : filtres, recherche, tri, états et libellés. Aucune dépendance à React,
 * pour pouvoir la tester seule.
 */

export type StoreStatus = 'integre' | 'non_installe' | 'a_jour' | 'mise_a_jour' | 'erreur' | 'en_revue';

export interface StoreGame {
  id: string;
  tag: string;
  latestVersion: string;
  name: string;
  description: string;
  author: string;
  moduleLabel: string;
  hasCover: boolean;
  error: string | null;
  builtin: boolean;
  status: StoreStatus;
  installedVersion: string | null;
  pendingVersion: string | null;
  autoUpdate: boolean;
  lastError: string | null;
}

export type StoreFilter = 'tous' | 'disponibles' | 'installes' | 'mises_a_jour' | 'en_revue' | 'integres' | 'erreurs';
export type StoreSort = 'nom' | 'auteur' | 'installes';

export const FILTER_ORDER: StoreFilter[] = [
  'tous',
  'disponibles',
  'installes',
  'mises_a_jour',
  'en_revue',
  'integres',
  'erreurs',
];

export const FILTER_LABEL: Record<StoreFilter, string> = {
  tous: 'Tous',
  disponibles: 'Disponibles',
  installes: 'Installés',
  mises_a_jour: 'Mises à jour',
  en_revue: 'En revue',
  integres: 'Intégrés',
  erreurs: 'Erreurs',
};

export const SORT_LABEL: Record<StoreSort, string> = {
  nom: 'Nom (A à Z)',
  auteur: 'Auteur',
  installes: 'Installés d’abord',
};

const STATUS_LABEL: Record<StoreStatus, string> = {
  integre: 'Intégré à l’application',
  non_installe: 'Non installé',
  a_jour: 'Installé, à jour',
  mise_a_jour: 'Mise à jour disponible',
  erreur: 'Échec de l’installation',
  en_revue: 'En attente de revue',
};

/** Installé ici, sous forme de paquet ou de jeu de code (même en attente de revue). */
export function isInstalled(game: StoreGame): boolean {
  return game.status === 'a_jour' || game.status === 'mise_a_jour' || game.status === 'en_revue';
}

/** Peut être installé maintenant : pas intégré, pas installé, et le dépôt a répondu pour ce jeu. */
export function isInstallable(game: StoreGame): boolean {
  return !game.builtin && (game.status === 'non_installe' || game.status === 'erreur') && game.error === null;
}

/** Une version plus récente est prête à être installée. */
export function isUpdatable(game: StoreGame): boolean {
  return !game.builtin && game.status === 'mise_a_jour';
}

/** Peut être supprimé : installé depuis le magasin, et pas intégré. */
export function isRemovable(game: StoreGame): boolean {
  return !game.builtin && isInstalled(game);
}

export function matchesFilter(game: StoreGame, filter: StoreFilter): boolean {
  switch (filter) {
    case 'tous':
      return true;
    case 'disponibles':
      return isInstallable(game);
    case 'installes':
      return isInstalled(game);
    case 'mises_a_jour':
      return game.status === 'mise_a_jour';
    case 'en_revue':
      return game.status === 'en_revue';
    case 'integres':
      return game.builtin;
    case 'erreurs':
      return game.status === 'erreur' || game.error !== null || game.lastError !== null;
  }
}

/** Texte comparable : sans accents, en minuscules. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function byName(a: StoreGame, b: StoreGame): number {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

function comparator(sort: StoreSort): (a: StoreGame, b: StoreGame) => number {
  if (sort === 'auteur') {
    return (a, b) => a.author.localeCompare(b.author, 'fr', { sensitivity: 'base' }) || byName(a, b);
  }
  if (sort === 'installes') {
    return (a, b) => Number(isInstalled(b)) - Number(isInstalled(a)) || byName(a, b);
  }
  return byName;
}

export interface StoreQuery {
  query: string;
  filter: StoreFilter;
  sort: StoreSort;
}

/** Jeux visibles : filtre, recherche (nom, auteur, description, type) et tri. */
export function filterGames(games: StoreGame[], { query, filter, sort }: StoreQuery): StoreGame[] {
  const needle = normalizeText(query.trim());
  return games
    .filter((game) => matchesFilter(game, filter))
    .filter(
      (game) =>
        needle === '' ||
        normalizeText(`${game.name} ${game.author} ${game.description} ${game.moduleLabel}`).includes(needle),
    )
    .sort(comparator(sort));
}

/** Nombre de jeux pour chaque filtre, sans tenir compte de la recherche. */
export function countByFilter(games: StoreGame[]): Record<StoreFilter, number> {
  const counts = {} as Record<StoreFilter, number>;
  for (const filter of FILTER_ORDER) counts[filter] = games.filter((game) => matchesFilter(game, filter)).length;
  return counts;
}

/** Libellé d’état avec la version : l’installée, et la nouvelle quand une mise à jour est prête. */
export function statusText(game: StoreGame): string {
  // Le serveur donne déjà une phrase lisible (« Fiche illisible. » ou la raison précise).
  if (game.error !== null) return game.error;
  if (game.status === 'mise_a_jour') return `Mise à jour disponible : ${game.installedVersion} → ${game.latestVersion}`;
  if (game.status === 'a_jour') return `Installé, à jour (${game.installedVersion})`;
  if (game.status === 'en_revue') {
    return `En attente de revue : version ${game.pendingVersion}. Approuvez-la dans « Jeux de code » pour la lancer.`;
  }
  return STATUS_LABEL[game.status];
}

/** Libellé court du badge d’état, pour la liste. */
export function shortStatus(game: StoreGame): string {
  // Une fiche illisible ne se télécharge pas : le badge doit le dire, pas afficher « Disponible ».
  if (game.error !== null) return 'Fiche illisible';
  if (game.status === 'mise_a_jour') return 'Mise à jour';
  if (game.status === 'a_jour') return 'Installé';
  if (game.status === 'en_revue') return 'En revue';
  if (game.status === 'integre') return 'Intégré';
  if (game.status === 'erreur') return 'Échec';
  return 'Disponible';
}

/** Identifiants des jeux à installer, parmi ceux donnés. */
/** Quota de l’API GitHub, tel que le serveur l’a lu. Sans jeton : 60 appels par heure. */
export interface RateLimit {
  limit: number;
  remaining: number;
  /** Heure de réinitialisation, en millisecondes depuis l’époque. */
  resetAt: number;
}

/** Appels GitHub à compter pour un jeu : lecture, commit, arbre, archive (estimation de la doc). */
export const CALLS_PER_GAME = 4;

/** Ligne d’information sur le quota restant, avec le délai avant réinitialisation. */
export function quotaLine(rate: RateLimit, now: number): string {
  const minutes = Math.max(1, Math.ceil((rate.resetAt - now) / 60_000));
  return `Appels GitHub restants : ${rate.remaining} sur ${rate.limit}, réinitialisés dans environ ${minutes} min.`;
}

/**
 * Avertissement avant une installation en lot : le quota restant suffit-il pour les jeux demandés ?
 * Null si oui, ou si le quota n’est pas connu (serveur avec jeton, ou aucun appel encore).
 */
export function quotaWarning(rate: RateLimit | null, gamesWanted: number, now: number): string | null {
  if (rate === null || gamesWanted === 0 || rate.resetAt <= now) return null;
  const needed = gamesWanted * CALLS_PER_GAME;
  if (rate.remaining >= needed) return null;
  return `Il reste ${rate.remaining} appel(s) GitHub, et ${gamesWanted} jeu(x) en demandent environ ${needed}. La file s’arrêtera à la limite : relancez-la après la réinitialisation pour le reste.`;
}

export function installableIds(games: StoreGame[]): string[] {
  return games.filter(isInstallable).map((game) => game.id);
}

export function updatableIds(games: StoreGame[]): string[] {
  return games.filter(isUpdatable).map((game) => game.id);
}

export function removableIds(games: StoreGame[]): string[] {
  return games.filter(isRemovable).map((game) => game.id);
}

/* ---------- File d’installation ---------- */

export type JobAction = 'install' | 'update';
export type JobState = 'attente' | 'en_cours' | 'ok' | 'erreur';

export interface JobItem {
  id: string;
  name: string;
  state: JobState;
  message: string | null;
}

export interface JobView {
  action: JobAction;
  items: JobItem[];
  startedAt: string;
  finishedAt: string | null;
}

/** Combien de jeux sont traités sur le total, et si la file est finie. */
export function jobProgress(job: JobView): { done: number; total: number; finished: boolean } {
  const done = job.items.filter((item) => item.state === 'ok' || item.state === 'erreur').length;
  return { done, total: job.items.length, finished: job.finishedAt !== null };
}

export const JOB_STATE_LABEL: Record<JobState, string> = {
  attente: 'En attente',
  en_cours: 'En cours…',
  ok: 'Terminé',
  erreur: 'Échec',
};

export function jobTitle(action: JobAction): string {
  return action === 'install' ? 'Installation' : 'Mise à jour';
}

/** Réponse d’une installation, d’une mise à jour ou d’une vérification. */
export type Outcome = { ok: true; status: string; version: string } | { ok: false; error: string; issues?: string[] };

/** Résumé d’une réponse, pour un message court. */
export function describeOutcome(outcome: Outcome): string {
  if (outcome.ok) return `${outcome.status} : version ${outcome.version}.`;
  return [outcome.error, ...(outcome.issues ?? [])].join(' ');
}
