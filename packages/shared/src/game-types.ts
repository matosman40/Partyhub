import type { ZodTypeAny } from 'zod';

/**
 * Contrat commun à tous les jeux de PartyHub.
 *
 * Principes :
 * - Le jeu reçoit un état et retourne un nouvel état (pas de mutation partagée).
 * - Le jeu ne dispose que d’un GameContext restreint : il ne voit ni la salle,
 *   ni les autres salles, ni le réseau.
 * - Le moteur valide les entrées avec `actions[type]` avant d’appeler `handleAction`.
 */

export interface PlayerRef {
  id: string;
  name: string;
  /** Profil du joueur, quand il en a un : permet de garder des données d’une partie à l’autre. */
  profileId?: string | null;
}

/**
 * Données qu’un jeu garde pour un profil, d’une partie à l’autre (par exemple les personnages d’un joueur).
 * Synchrone et borné : le jeu valide ce qu’il lit, et ne reçoit jamais les données d’un autre profil.
 * Absent quand la salle ne peut pas stocker (aucun profil, ou stockage indisponible).
 */
export interface ProfileDataStore {
  /** Données du profil pour ce jeu, ou null. Une valeur illisible renvoie null. */
  read(profileId: string): unknown | null;
  /** Remplace les données du profil pour ce jeu. Lève une erreur si la valeur est trop volumineuse. */
  write(profileId: string, value: unknown): void;
}

/** Catégories d’images que les jeux peuvent demander : un portrait de personnage, ou un fond de décor. */
export type GameImageKind = 'portrait' | 'fond';

/** Identifiant d’image gardée par le serveur : 24 caractères hexadécimaux. */
export const GAME_IMAGE_ID = /^[a-f0-9]{24}$/;

/** Image gardée dans la bibliothèque partagée. `tag` range l’image par thème, pour la réutiliser. */
export interface GameImage {
  id: string;
  kind: GameImageKind;
  tag: string;
  /** Adresse publique de l’image (chemin relatif au serveur). */
  url: string;
}

export interface GameImageRequest {
  kind: GameImageKind;
  /** Description de l’image, en français ou en anglais. Les jeux écrivent leur propre style. */
  prompt: string;
  /** Thème de rangement : l’image sera réutilisable pour ce même thème. */
  tag: string;
  signal?: AbortSignal;
}

/**
 * Bibliothèque d’images partagée par les jeux : générer une image, ou reprendre celles déjà gardées.
 * Une image qui n’a pas pu être générée renvoie null : le jeu garde alors son rendu de secours.
 */
export interface GameImages {
  /** Faux quand aucun fournisseur d’images n’est configuré. */
  available(): boolean;
  /** Génère une image et la garde dans la bibliothèque. Null en cas d’échec, de limite atteinte ou d’annulation. */
  generate(request: GameImageRequest): Promise<GameImage | null>;
  /** Images déjà gardées pour cette catégorie et ce thème, les plus anciennes d’abord. */
  list(kind: GameImageKind, tag: string): GameImage[];
}

export interface GameContext {
  /** Données par profil pour ce jeu (voir `ProfileDataStore`). */
  profileData?: ProfileDataStore;
  /** Images générées par un fournisseur (portraits, fonds). Absent si aucun fournisseur d’images n’est configuré. */
  images?: GameImages;
  /** Horloge serveur, en millisecondes epoch. */
  now(): number;
  /** Planifie un minuteur nommé : `onTimer(state, key)` sera appelé à échéance. */
  schedule(key: string, delayMs: number): void;
  /** Annule un minuteur nommé s’il existe. */
  cancel(key: string): void;
  /** Générateur aléatoire injectable (tests déterministes). */
  random(): number;
  /** Identifiants des joueurs actuellement connectés. */
  connectedPlayerIds(): string[];
  /**
   * Client d’IA générative, absent si aucune clé n’est configurée. Seul `runJob` doit l’utiliser :
   * le moteur, lui, reste synchrone et ne voit jamais la clé.
   */
  ai?: AiClient;
}

/** Requête envoyée à un modèle de langage : une consigne système, un message utilisateur, une taille maximale. */
export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}

/** Client d’IA générative. `complete` renvoie le texte brut de la réponse ; le jeu le valide lui-même. */
export interface AiClient {
  complete(request: AiRequest): Promise<string>;
  /** Faux quand aucun fournisseur n’est configuré : le jeu prend alors son histoire de secours, sans erreur. */
  available?(): boolean;
}

/**
 * Travail asynchrone demandé par un jeu (par exemple une génération de texte). Le moteur le décrit dans son
 * état ; la salle l’exécute hors du moteur avec `runJob`, puis lui transmet le résultat avec `completeJob`.
 * `id` change à chaque nouveau travail : un résultat tardif d’un travail abandonné est ignoré.
 */
export interface GameJob {
  id: string;
  kind: string;
  input: unknown;
}

export type JobOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/** Catégorie affichée dans le catalogue pour filtrer les jeux. */
export type GameCategory = 'cartes' | 'plateau' | 'quiz' | 'role' | 'solo';

/** Notice d’un jeu : but, étapes dans l’ordre, conseils. Modifiable par l’administrateur. */
export interface GameNotice {
  goal: string;
  steps: string[];
  tips: string[];
}

/** Une entrée du journal d’un jeu : son numéro de version à cette date, la date, et ce qui a changé. */
export interface GameRelease {
  version: string;
  /** Date de publication, au format AAAA-MM-JJ. */
  date: string;
  /** Changements visibles, en phrases courtes. */
  changes: string[];
}

export interface GameManifest {
  id: string;
  category: GameCategory;
  name: string;
  description: string;
  icon: string;
  version: string;
  /** Version de l’interface de plugin attendue par le moteur. */
  apiVersion: 1;
  minPlayers: number;
  maxPlayers: number;
  /** Durée indicative, en minutes. */
  durationMin: number;
  /** Notice par défaut (surchargeable depuis l’administration). */
  notice: GameNotice;
  /** Absent ou vrai : le jeu figure au catalogue. Faux : il ne s’affiche que dans l’administration (outils). */
  listed?: boolean;
  /** Vrai si le jeu s’appuie sur une IA générative (texte ou images) quand elle est configurée. Sert au filtre du catalogue. */
  ai?: boolean;
}

/** Action proposée par le moteur à un robot (mode test). `key` identifie la décision en cours. */
export interface BotSuggestion {
  type: string;
  payload?: unknown;
  key: string;
}

export interface ScoreEntry {
  playerId: string;
  name: string;
  points: number;
  /** Classement en « compétition » : deux ex æquo partagent le même rang. */
  rank: number;
}

export type GameResult<S> = { ok: true; state: S } | { ok: false; error: string };

export interface GameModule<S = any, C = any> {
  manifest: GameManifest;
  /** Schéma des réglages configurables par l’hôte. */
  settingsSchema: ZodTypeAny;
  defaultSettings: C;
  /** Actions acceptées des joueurs : type -> schéma du payload. */
  actions: Record<string, ZodTypeAny>;

  initialize(settings: C, players: PlayerRef[], ctx: GameContext): S;
  onPlayerJoin(state: S, player: PlayerRef, ctx: GameContext): S;
  onPlayerLeave(state: S, player: PlayerRef, ctx: GameContext): S;
  start(state: S, ctx: GameContext): GameResult<S>;
  handleAction(state: S, player: PlayerRef, type: string, payload: unknown, ctx: GameContext): GameResult<S>;
  onTimer(state: S, key: string, ctx: GameContext): S;
  nextRound(state: S, ctx: GameContext): S;
  calculateScores(state: S): ScoreEntry[];
  end(state: S, ctx: GameContext): S;

  /** Vue visible par tous (y compris les téléphones), sans données privées. */
  getPublicState(state: S): unknown;
  /** Vue privée d’un joueur : ne contient jamais les réponses des autres. */
  getPlayerState(state: S, playerId: string): unknown;
  /** Vue destinée à l’écran principal (TV / ordinateur). */
  getHostState(state: S): unknown;
  isFinished(state: S): boolean;

  /**
   * Optionnel : propose l’action qu’un robot jouerait maintenant (mode test).
   * Doit renvoyer null quand le robot n’a rien à faire. Sans cette méthode, le robot reste passif.
   * `now` est l’horloge de la partie (celle de `ctx.now()`) : à comparer aux échéances du jeu, jamais Date.now().
   */
  suggest?(state: S, playerId: string, random: () => number, now: number): BotSuggestion | null;

  /**
   * Optionnel : action que le robot-hôte jouerait maintenant (mode test), pour un jeu dont les actions viennent de
   * l’écran principal (`hostActions`). Même règle que `suggest` : null quand il n’y a rien à faire.
   */
  suggestHost?(state: S, random: () => number, now: number): BotSuggestion | null;

  /**
   * Optionnel : actions que l’écran principal (hôte) peut demander, par exemple « générer des personnages ».
   * Elles ne sont pas attribuées à un joueur. Les schémas valident le payload comme pour les joueurs.
   */
  hostActions?: Record<string, ZodTypeAny>;
  handleHostAction?(state: S, type: string, payload: unknown, ctx: GameContext): GameResult<S>;

  /**
   * Jeux de code uniquement : bundle des vues (iframe) et son empreinte. Absent pour les jeux intégrés
   * et les jeux déclaratifs, qui gardent leurs vues dans l’application.
   */
  codeView?: { script: string; sha256: string };

  /**
   * Optionnel : travail asynchrone en attente, ou null. Doit rester identique tant que le travail n’est pas
   * terminé. La salle l’exécute en dehors du moteur, sans bloquer les autres salles.
   */
  pendingJob?(state: S): GameJob | null;
  /** Exécute le travail (réseau compris). Ne doit pas modifier l’état : il renvoie seulement une valeur. */
  runJob?(job: GameJob, ctx: GameContext, signal: AbortSignal): Promise<unknown>;
  /** Intègre le résultat (ou l’échec) d’un travail. Un identifiant périmé doit laisser l’état inchangé. */
  completeJob?(state: S, jobId: string, outcome: JobOutcome, ctx: GameContext): S;
}
