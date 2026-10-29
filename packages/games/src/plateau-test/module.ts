import { z } from 'zod';
import { PLATEAU_TEST_ID, type GameModule } from '@partyhub/shared';

/**
 * Plateau de test : une salle où chacun déplace son personnage sur le plateau et fait ses gestes,
 * pour essayer le salon et ses déplacements. Il n’y a pas de partie : le bouton de
 * lancement n’est pas affiché, et le serveur refuse le lancement. Le jeu n’est pas listé au
 * catalogue : il s’ouvre depuis le bouton « Essayer le plateau » de l’accueil.
 */

export type PlateauTestState = Record<string, never>;

const NOT_A_GAME = 'Le plateau de test ne se lance pas : il sert à essayer les déplacements et les gestes.';

export const plateauTest: GameModule<PlateauTestState, Record<string, never>> = {
  manifest: {
    id: PLATEAU_TEST_ID,
    category: 'plateau',
    name: 'Plateau de test',
    description: 'Déplacez votre personnage sur le plateau : poussez, portez, sautez et saluez.',
    icon: '🧭',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 5,
    listed: false,
    notice: {
      goal: 'Essayer les déplacements, les gestes et les décors du plateau, avant une vraie partie.',
      steps: [
        'Avancez avec la croix de direction (ou les flèches du clavier).',
        'Action pousse ou porte ce qui est devant vous ; Sauter passe par-dessus un obstacle ; Saluer fait un signe.',
        'On monte sur une plateforme en sautant dessus ; on en descend en marchant. Sept décors existent, du jardin à la banquise.',
      ],
      tips: ['Rien n’est enregistré : les positions disparaissent avec la salle.'],
    },
  },

  settingsSchema: z.object({}),
  defaultSettings: {},

  // Aucune action de jeu : les déplacements et gestes passent par le salon, pas par `player:action`.
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
