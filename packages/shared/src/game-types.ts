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
}

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
  handleAction(
    state: S,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<S>;
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
}
