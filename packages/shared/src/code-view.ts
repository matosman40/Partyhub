/**
 * Vues des jeux de code : elles tournent dans un iframe sandboxé (sans même origine que la page).
 * La page et l'iframe échangent uniquement les messages décrits ici, par `postMessage`.
 *
 * Sens page -> iframe :
 * - `render` : rend la vue `role` avec les props sérialisables (états, réglages, identifiant).
 * - `reply`  : réponse à un appel de l'iframe (`call`).
 *
 * Sens iframe -> page :
 * - `ready`  : la vue est prête, la page envoie le premier `render`.
 * - `call`   : demande d'envoyer une action au serveur (`send` ou `onAction`), la réponse suit en `reply`.
 * - `change` : nouveaux réglages (vue de salon).
 * - `error`  : la vue a planté ; la page affiche le message à la place.
 */

export const CODE_VIEW_MESSAGE = {
  ready: 'ready',
  render: 'render',
  call: 'call',
  reply: 'reply',
  change: 'change',
  error: 'error',
} as const;

/** Rôles de vue : écran principal (TV), téléphone (joueur), réglages (salon). */
export type CodeViewRole = 'host' | 'player' | 'settings';

/**
 * Méthodes que l'iframe peut appeler sur la page.
 * - `send` / `onAction` : envoyer une action au serveur.
 * - `micCheck` : demande l'accès au micro (vue joueur). La page ouvre le micro, pas la vue : une vue sandboxée
 *   n'a pas d'origine, et le navigateur refuse le micro à une telle origine.
 * - `voice` (ms) : enregistre la voix pendant `ms` millisecondes (au plus 30 s) et renvoie `data` (data URL audio).
 * - `voiceStop` : arrête l'enregistrement en cours ; l'appel `voice` renvoie alors une erreur, sans données.
 */
export type CodeViewMethod = 'send' | 'onAction' | 'micCheck' | 'voice' | 'voiceStop';

/** Durée maximale d'un enregistrement demandé par une vue (ms). */
export const VOICE_MAX_MS = 30_000;

/** Adresse de la vue d'un jeu de code, avec l'empreinte du bundle (l'adresse change avec le contenu). */
export interface CodeViewRef {
  url: string;
  sha256: string;
}

/**
 * Adresse du document de vues d'un jeu de code (celui que l'iframe charge), pour une empreinte donnée.
 * Le document a sa propre politique (servie par le serveur) : il n'hérite pas de celle de la page.
 */
export function codeViewUrl(gameId: string, sha256: string): string {
  return `/api/code-games/${encodeURIComponent(gameId)}/${sha256}/view.html`;
}

/** Adresse du script de vues, appelé par le document ci-dessus. */
export function codeViewScriptUrl(gameId: string, sha256: string): string {
  return `/api/code-games/${encodeURIComponent(gameId)}/${sha256}/views.js`;
}
