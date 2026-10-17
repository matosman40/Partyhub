import type { ComponentType } from 'react';
import type { SettingsBounds } from '@partyhub/shared';

/**
 * Contrat d'affichage d'un jeu côté navigateur.
 * Chaque jeu fournit trois composants :
 * - Settings : réglages affichés dans le salon (TV, avant le lancement) ;
 * - Host : écran principal (TV / ordinateur) ;
 * - Player : interface du smartphone.
 *
 * Les états reçus sont ceux produits par getPublicState / getHostState /
 * getPlayerState côté serveur : le navigateur n'a jamais la bonne réponse
 * avant la phase de révélation.
 */

export interface SettingsProps {
  settings: Record<string, unknown>;
  disabled: boolean;
  onChange: (settings: Record<string, unknown>) => void;
  /** Bornes exactes données par le serveur ; à défaut, celles du formulaire. */
  bounds?: SettingsBounds;
}

export interface HostViewProps {
  publicState: any;
  hostState: any;
  /** Horodatage serveur au moment de l'émission de la vue. */
  now: number;
  /**
   * Envoie une action de l'écran principal au jeu (ex. générer des personnages). Absent quand la vue
   * n'est pas celle de l'hôte (spectateur) : le jeu n'affiche alors pas les boutons correspondants.
   */
  onAction?: (type: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;
}

export interface PlayerViewProps {
  publicState: any;
  playerState: any;
  playerId: string;
  now: number;
  /** Envoie une action au serveur et attend sa validation. */
  send: (type: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;
  /** Vrai quand la connexion au salon est établie : le jeu efface un message de coupure une fois la connexion revenue. */
  connected?: boolean;
}

export interface GameClientViews {
  Settings: ComponentType<SettingsProps>;
  Host: ComponentType<HostViewProps>;
  Player: ComponentType<PlayerViewProps>;
}
