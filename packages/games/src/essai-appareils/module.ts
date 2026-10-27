import { z } from 'zod';
import type { GameModule } from '@partyhub/shared';

/**
 * Essai des appareils : un jeu pour vérifier, téléphone par téléphone, le micro, la caméra, le mouvement
 * et le dessin. Pas de score : chaque téléphone fait chaque essai, puis déclare s'il a réussi.
 *
 * Le serveur ne voit ni le son, ni l'image, ni le geste : il enregistre seulement le résultat déclaré.
 * C'est un outil de contrôle, pas un défi à gagner.
 */

/** Les quatre essais, dans l’ordre. */
export const ESSAIS = ['micro', 'camera', 'mouvement', 'dessin'] as const;
export type Essai = (typeof ESSAIS)[number];

export const LIBELLE_ESSAI: Record<Essai, string> = {
  micro: 'Micro',
  camera: 'Caméra',
  mouvement: 'Mouvement',
  dessin: 'Dessin',
};

const settingsSchema = z.object({});
export type EssaiSettings = z.infer<typeof settingsSchema>;

export interface EssaiState {
  settings: EssaiSettings;
  phase: 'ready' | 'essai' | 'final';
  /** Indice de l’essai en cours, dans ESSAIS. */
  index: number;
  names: Record<string, string>;
  /** Résultat déclaré par chaque téléphone, essai par essai. Absent tant que le téléphone n’a pas répondu. */
  resultats: Record<string, Partial<Record<Essai, boolean>>>;
}

export const essaiAppareils: GameModule<EssaiState, EssaiSettings> = {
  manifest: {
    id: 'essai-appareils',
    category: 'solo',
    name: 'Essai des appareils',
    description: 'Vérifiez le micro, la caméra, le mouvement et le dessin de chaque téléphone.',
    icon: '🧪',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 4,
    notice: {
      goal: 'Vérifier que chaque téléphone sait faire ce dont les jeux ont besoin.',
      steps: [
        'L’écran principal lance chaque essai, et tout le monde le fait sur son téléphone.',
        'Micro : maintenez un son pendant une seconde. Caméra : démarrez-la et vérifiez votre image.',
        'Mouvement : penchez le téléphone à gauche, puis à droite. Dessin : tracez un trait et validez.',
        'Chaque téléphone indique ensuite si l’essai a réussi. Le bilan s’affiche sur l’écran principal.',
      ],
      tips: [
        'Un essai en échec n’est pas une panne du jeu : le navigateur ou le réglage du téléphone bloque souvent le capteur.',
        'Un iPhone ne donne le mouvement qu’après un bouton d’autorisation, et seulement en HTTPS.',
      ],
    },
  },

  settingsSchema,
  defaultSettings: settingsSchema.parse({}),

  actions: {
    rapport: z.object({ reussi: z.boolean() }),
  },

  initialize(settings, players) {
    return {
      settings: settingsSchema.parse(settings),
      phase: 'ready',
      index: 0,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      resultats: {},
    };
  },

  onPlayerJoin(s, p) {
    return { ...s, names: { ...s.names, [p.id]: p.name } };
  },

  onPlayerLeave(s, p) {
    const names = { ...s.names };
    delete names[p.id];
    return { ...s, names };
  },

  start(s) {
    if (s.phase !== 'ready') return { ok: false, error: 'Les essais ont déjà commencé' };
    return { ok: true, state: { ...s, phase: 'essai', index: 0 } };
  },

  handleAction(s, p, type, payload) {
    if (type !== 'rapport') return { ok: false, error: 'Action inconnue' };
    if (s.phase !== 'essai') return { ok: false, error: 'Aucun essai en cours' };
    const essai = ESSAIS[s.index];
    if (s.resultats[p.id]?.[essai] !== undefined) return { ok: false, error: 'Résultat déjà envoyé pour cet essai' };
    const { reussi } = payload as { reussi: boolean };
    const mine = { ...(s.resultats[p.id] ?? {}), [essai]: reussi };
    return { ok: true, state: { ...s, resultats: { ...s.resultats, [p.id]: mine } } };
  },

  // Pas de minuteur : l’écran principal fait avancer les essais.
  onTimer: (s) => s,

  nextRound(s) {
    if (s.phase !== 'essai') return s;
    if (s.index + 1 < ESSAIS.length) return { ...s, index: s.index + 1 };
    return { ...s, phase: 'final' };
  },

  // Pas de score : c’est un contrôle.
  calculateScores: () => [],

  end: (s) => ({ ...s, phase: 'final' }),

  // Vue visible par tous : les résultats déclarés sont publics (ce sont des tests, pas des réponses secrètes).
  getPublicState(s) {
    const etape = s.phase === 'essai' ? ESSAIS[s.index] : null;
    const ids = Object.keys(s.names);
    return {
      phase: s.phase,
      etape,
      index: s.index,
      etapes: ESSAIS.map((e) => ({ id: e, libelle: LIBELLE_ESSAI[e] })),
      joueurs: ids.map((id) => ({
        id,
        nom: s.names[id],
        resultats: ESSAIS.map((e) => s.resultats[id]?.[e] ?? null),
      })),
      repondus: etape ? ids.filter((id) => s.resultats[id]?.[etape] !== undefined).length : 0,
      total: ids.length,
    };
  },

  // Vue privée : seulement l’état du joueur concerné pour l’essai en cours.
  getPlayerState(s, playerId) {
    const etape = s.phase === 'essai' ? ESSAIS[s.index] : null;
    const reponse = etape ? s.resultats[playerId]?.[etape] : undefined;
    return { etape, aRepondu: reponse !== undefined, monResultat: reponse ?? null };
  },

  // Liste des téléphones qui n’ont pas encore répondu à l’essai en cours.
  getHostState(s) {
    if (s.phase !== 'essai') return { attente: [] as string[] };
    const essai = ESSAIS[s.index];
    return {
      attente: Object.keys(s.names)
        .filter((id) => s.resultats[id]?.[essai] === undefined)
        .map((id) => s.names[id]),
    };
  },

  isFinished: (s) => s.phase === 'final',
};
