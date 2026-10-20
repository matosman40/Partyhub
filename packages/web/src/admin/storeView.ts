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
  if (game.status === 'mise_a_jour') return `Mise à jour disponible : ${game.installedVersion} → ${game.latestVersion}`;
  if (game.status === 'a_jour') return `Installé, à jour (${game.installedVersion})`;
  if (game.status === 'en_revue') {
    return `En attente de revue : version ${game.pendingVersion}. Approuvez-la dans « Jeux de code » pour la lancer.`;
  }
  return STATUS_LABEL[game.status];
}

/** Libellé court du badge d’état, pour la liste. */
export function shortStatus(game: StoreGame): string {
  if (game.status === 'mise_a_jour') return 'Mise à jour';
  if (game.status === 'a_jour') return 'Installé';
  if (game.status === 'en_revue') return 'En revue';
  if (game.status === 'integre') return 'Intégré';
  if (game.status === 'erreur') return 'Échec';
  return 'Disponible';
}

/** Identifiants des jeux à installer, parmi ceux donnés. */
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
