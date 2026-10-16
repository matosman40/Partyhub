import type { ZodTypeAny } from 'zod';

/**
 * Contrat commun à tous les jeux de PartyHub.
 *
 * Principes :
 * - Le jeu reçoit un état et retourne un nouvel état (pas de mutation partagée).
 * - Le jeu ne dispose que d'un GameContext restreint : il ne voit ni la salle,
 *   ni les autres salles, ni le réseau.
 * - Le moteur valide les entrées avec `actions[type]` avant d'appeler `handleAction`.
 */

export interface PlayerRef {
  id: string;
  name: string;
}

export interface GameContext {
  /** Horloge serveur, en millisecondes epoch. */
  now(): number;
  /** Planifie un minuteur nommé : `onTimer(state, key)` sera appelé à échéance. */
  schedule(key: string, delayMs: number): void;
  /** Annule un minuteur nommé s'il existe. */
  cancel(key: string): void;
  /** Générateur aléatoire injectable (tests déterministes). */
  random(): number;
  /** Identifiants des joueurs actuellement connectés. */
  connectedPlayerIds(): string[];
  /**
   * Client d'IA générative, absent si aucune clé n'est configurée. Seul `runJob` doit l'utiliser :
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

/** Client d'IA générative. `complete` renvoie le texte brut de la réponse ; le jeu le valide lui-même. */
export interface AiClient {
  complete(request: AiRequest): Promise<string>;
}

/**
 * Travail asynchrone demandé par un jeu (par exemple une génération de texte). Le moteur le décrit dans son
 * état ; la salle l'exécute hors du moteur avec `runJob`, puis lui transmet le résultat avec `completeJob`.
 * `id` change à chaque nouveau travail : un résultat tardif d'un travail abandonné est ignoré.
 */
export interface GameJob {
  id: string;
  kind: string;
  input: unknown;
}

export type JobOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/** Catégorie affichée dans le catalogue pour filtrer les jeux. */
export type GameCategory = 'cartes' | 'plateau' | 'quiz' | 'role' | 'solo';

/** Notice d'un jeu : but, étapes dans l'ordre, conseils. Modifiable par l'administrateur. */
export interface GameNotice {
  goal: string;
  steps: string[];
  tips: string[];
}

export interface GameManifest {
  id: string;
  category: GameCategory;
  name: string;
  description: string;
  icon: string;
  version: string;
  /** Version de l'interface de plugin attendue par le moteur. */
  apiVersion: 1;
  minPlayers: number;
  maxPlayers: number;
  /** Durée indicative, en minutes. */
  durationMin: number;
  /** Notice par défaut (surchargeable depuis l'administration). */
  notice: GameNotice;
  /** Absent ou vrai : le jeu figure au catalogue. Faux : il ne s'affiche que dans l'administration (outils). */
  listed?: boolean;
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
  /** Schéma des réglages configurables par l'hôte. */
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
  /** Vue privée d'un joueur : ne contient jamais les réponses des autres. */
  getPlayerState(state: S, playerId: string): unknown;
  /** Vue destinée à l'écran principal (TV / ordinateur). */
  getHostState(state: S): unknown;
  isFinished(state: S): boolean;

  /**
   * Optionnel : propose l'action qu'un robot jouerait maintenant (mode test).
   * Doit renvoyer null quand le robot n'a rien à faire. Sans cette méthode, le robot reste passif.
   */
  suggest?(state: S, playerId: string, random: () => number): BotSuggestion | null;

  /**
   * Optionnel : actions que l'écran principal (hôte) peut demander, par exemple « générer des personnages ».
   * Elles ne sont pas attribuées à un joueur. Les schémas valident le payload comme pour les joueurs.
   */
  hostActions?: Record<string, ZodTypeAny>;
  handleHostAction?(state: S, type: string, payload: unknown, ctx: GameContext): GameResult<S>;

  /**
   * Optionnel : travail asynchrone en attente, ou null. Doit rester identique tant que le travail n'est pas
   * terminé. La salle l'exécute en dehors du moteur, sans bloquer les autres salles.
   */
  pendingJob?(state: S): GameJob | null;
  /** Exécute le travail (réseau compris). Ne doit pas modifier l'état : il renvoie seulement une valeur. */
  runJob?(job: GameJob, ctx: GameContext, signal: AbortSignal): Promise<unknown>;
  /** Intègre le résultat (ou l'échec) d'un travail. Un identifiant périmé doit laisser l'état inchangé. */
  completeJob?(state: S, jobId: string, outcome: JobOutcome, ctx: GameContext): S;
}
