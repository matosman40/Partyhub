/**
 * Vues des jeux de code : elles tournent dans un iframe sandboxé (sans même origine que la page).
 * La page et l'iframe échangent uniquement les messages décrits ici, par `postMessage`.
 *
 * Sens page -> iframe :
 * - `render` : rend la vue `role` avec les props sérialisables (états, réglages, identifiant).
 * - `reply`  : réponse à un appel de l'iframe (`call`).
 *
 * - `sounds` : table des bruitages de l'installation (réglages de l'administration).
 * - `mediaReply` : réponse à une demande de média (`media`), avec les octets du fichier.
 *
 * Sens iframe -> page :
 * - `ready`  : la vue est prête, la page envoie le premier `render`.
 * - `call`   : demande d'envoyer une action au serveur (`send` ou `onAction`), la réponse suit en `reply`.
 * - `change` : nouveaux réglages (vue de salon).
 * - `error`  : la vue a planté ; la page affiche le message à la place.
 * - `media`  : demande d'un média de l'installation (bibliothèque, avatars, images, sons). La page ne sert que
 *   les adresses de `isCodeMediaUrl`, et renvoie `mediaReply`.
 */

export const CODE_VIEW_MESSAGE = {
  ready: 'ready',
  render: 'render',
  call: 'call',
  reply: 'reply',
  change: 'change',
  error: 'error',
  media: 'media',
  mediaReply: 'mediaReply',
  sounds: 'sounds',
} as const;

/** Taille maximale d'un média relayé à une vue, en octets. */
export const CODE_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Adresses de médias qu'une vue de jeu de code peut demander à la page : la bibliothèque, les avatars (liste et
 * planches), les images générées. Rien d'autre : pas d'autre route de l'API, pas de chemin relatif ni d'adresse externe.
 */
const CODE_MEDIA_PATHS: RegExp[] = [
  /^\/api\/assets\/[A-Za-z0-9._-]{1,120}$/,
  /^\/api\/ai-images\/[A-Za-z0-9._-]{1,120}$/,
  /^\/api\/character-packs$/,
  /^\/api\/character-packs\/[A-Za-z0-9._%/-]{1,300}$/,
];

/** Vrai pour une adresse de média de l'installation qu'une vue de jeu de code peut demander. */
export function isCodeMediaUrl(url: string): boolean {
  if (url.includes('..') || url.includes('//') || url.includes('\\')) return false;
  return CODE_MEDIA_PATHS.some((pattern) => pattern.test(url));
}

/** Rôles de vue : écran principal (TV), téléphone (joueur), réglages (salon). */
export type CodeViewRole = 'host' | 'player' | 'settings';

/** Méthodes que l'iframe peut appeler sur la page. */
export type CodeViewMethod = 'send' | 'onAction';

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
