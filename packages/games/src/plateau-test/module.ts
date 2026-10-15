import { z } from 'zod';
import { PLATEAU_TEST_ID, type GameModule } from '@partyhub/shared';

/**
 * Plateau de test : une salle où chacun déplace son personnage sur le plateau et envoie une
 * émotion, pour essayer le salon et ses déplacements. Il n'y a pas de partie : le bouton de
 * lancement n'est pas affiché, et le serveur refuse le lancement. Le jeu n'est pas listé au
 * catalogue : il s'ouvre depuis le bouton « Essayer le plateau » de l'accueil.
 */

export type PlateauTestState = Record<string, never>;

const NOT_A_GAME = 'Le plateau de test ne se lance pas : il sert à essayer les déplacements et les émotions.';

export const plateauTest: GameModule<PlateauTestState, Record<string, never>> = {
  manifest: {
    id: PLATEAU_TEST_ID,
    category: 'plateau',
    name: 'Plateau de test',
    description: 'Déplacez votre personnage sur le plateau et envoyez une émotion à toute la salle.',
    icon: '🧭',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 5,
    listed: false,
    notice: {
      goal: 'Essayer les déplacements et les émotions du plateau, avant une vraie partie.',
      steps: [
        'Glissez votre personnage sur le plateau, touchez un endroit libre, ou utilisez les flèches du clavier.',
        'Envoyez une émotion : elle s’affiche au-dessus de votre personnage, sur l’écran et sur les téléphones.',
      ],
      tips: ['Rien n’est enregistré : les positions disparaissent avec la salle.'],
    },
  },

  settingsSchema: z.object({}),
  defaultSettings: {},

  // Aucune action de jeu : les déplacements et émotions passent par le salon, pas par `player:action`.
  actions: {},

  initialize: () => ({}),
  onPlayerJoin: (state) => state,
  onPlayerLeave: (state) => state,
  start: () => ({ ok: false, error: NOT_A_GAME }),
  handleAction: () => ({ ok: false, error: 'Aucune action de jeu dans le plateau de test.' }),
  onTimer: (state) => state,
  nextRound: (state) => state,
  calculateScores: () => [],
  end: (state) => state,

  getPublicState: () => null,
  getPlayerState: () => null,
  getHostState: () => null,
  isFinished: () => false,
};
