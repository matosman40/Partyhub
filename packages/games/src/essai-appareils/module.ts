import { z } from 'zod';
import type { GameModule } from '@partyhub/shared';

/**
 * Essai des appareils : un jeu pour vérifier, téléphone par téléphone, le micro, la caméra, le mouvement
 * et le dessin. Pas de score : chaque téléphone fait chaque essai, puis déclare s'il a réussi.
 *
 * Le serveur ne voit ni le son, ni l'image, ni le geste : il enregistre seulement le résultat déclaré.
 * C'est un outil de contrôle, pas un défi à gagner. Les seuils (durée du son, longueur du trait, angle
 * d'inclinaison) sont réglés par l'hôte et donnés à tous les téléphones, pour que la règle soit la même partout.
 */

/** Les quatre essais possibles, dans l’ordre par défaut. */
export const ESSAIS = ['micro', 'camera', 'mouvement', 'dessin'] as const;
export type Essai = (typeof ESSAIS)[number];

export const LIBELLE_ESSAI: Record<Essai, string> = {
  micro: 'Micro',
  camera: 'Caméra',
  mouvement: 'Mouvement',
  dessin: 'Dessin',
};

export const ICONE_ESSAI: Record<Essai, string> = {
  micro: '🎤',
  camera: '📷',
  mouvement: '🧭',
  dessin: '✏️',
};

const settingsSchema = z.object({
  micro: z.boolean().default(true),
  camera: z.boolean().default(true),
  mouvement: z.boolean().default(true),
  dessin: z.boolean().default(true),
  /** Durée pendant laquelle le son doit être entendu, en millisecondes. */
  dureeSon: z.number().int().min(500).max(3000).default(1000),
  /** Longueur de trait à tracer, en pixels du dessin (640 px de large). */
  longueurTrait: z.number().int().min(50).max(400).default(150),
  /** Angle d’inclinaison à atteindre de chaque côté, en pourcentage de l’inclinaison maximale. */
  inclinaison: z.number().int().min(30).max(90).default(50),
  /** Autorise un téléphone à refaire un essai et à corriger son résultat. */
  reprise: z.boolean().default(true),
});
export type EssaiSettings = z.infer<typeof settingsSchema>;

export interface EssaiState {
  settings: EssaiSettings;
  /** Essais retenus par l’hôte, dans l’ordre. Jamais vide. */
  essais: Essai[];
  phase: 'ready' | 'essai' | 'final';
  /** Indice de l’essai en cours, dans `essais`. */
  index: number;
  names: Record<string, string>;
  /** Résultat déclaré par chaque téléphone, essai par essai. Absent tant que le téléphone n’a pas répondu. */
  resultats: Record<string, Partial<Record<Essai, boolean>>>;
}

/** Essais retenus : ceux qui sont activés, ou tous si l’hôte les a tous désactivés. */
function essaisRetenus(settings: EssaiSettings): Essai[] {
  const retenus = ESSAIS.filter((e) => settings[e]);
  return retenus.length > 0 ? [...retenus] : [...ESSAIS];
}

export const essaiAppareils: GameModule<EssaiState, EssaiSettings> = {
  manifest: {
    id: 'essai-appareils',
    category: 'solo',
    name: 'Essai des appareils',
    description: 'Vérifiez le micro, la caméra, le mouvement et le dessin de chaque téléphone.',
    icon: '🧪',
    version: '1.1.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 4,
    notice: {
      goal: 'Vérifier que chaque téléphone sait faire ce dont les jeux ont besoin.',
      steps: [
        'L’écran principal lance chaque essai, et tout le monde le fait sur son téléphone.',
        'Micro : maintenez un son. Caméra : démarrez-la et vérifiez votre image.',
        'Mouvement : penchez le téléphone d’un côté, puis de l’autre. Dessin : tracez un trait et validez.',
        'Chaque téléphone déclare ensuite son résultat. Le tableau de la salle reprend tous les résultats.',
      ],
      tips: [
        'Un essai en échec n’est pas une panne du jeu : le navigateur ou le réglage du téléphone bloque souvent le capteur.',
        'Un iPhone ne donne le mouvement qu’après un bouton d’autorisation, et seulement en HTTPS.',
        'Dans les options, désactivez les essais que vous ne voulez pas, et réglez les seuils pour les appareils difficiles.',
      ],
    },
  },

  settingsSchema,
  defaultSettings: settingsSchema.parse({}),

  actions: {
    rapport: z.object({ reussi: z.boolean() }),
  },

  initialize(settings, players) {
    const parsed = settingsSchema.parse(settings);
    return {
      settings: parsed,
      essais: essaisRetenus(parsed),
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
    const essai = s.essais[s.index];
    if (!s.settings.reprise && s.resultats[p.id]?.[essai] !== undefined) {
      return { ok: false, error: 'Résultat déjà envoyé pour cet essai' };
    }
    const { reussi } = payload as { reussi: boolean };
    const mine = { ...(s.resultats[p.id] ?? {}), [essai]: reussi };
    return { ok: true, state: { ...s, resultats: { ...s.resultats, [p.id]: mine } } };
  },

  // Pas de minuteur : l’écran principal fait avancer les essais.
  onTimer: (s) => s,

  nextRound(s) {
    if (s.phase !== 'essai') return s;
    if (s.index + 1 < s.essais.length) return { ...s, index: s.index + 1 };
    return { ...s, phase: 'final' };
  },

  // Pas de score : c’est un contrôle.
  calculateScores: () => [],

  end: (s) => ({ ...s, phase: 'final' }),

  // Vue visible par tous : les résultats déclarés sont publics (ce sont des tests, pas des réponses secrètes).
  // Les seuils sont donnés pour que chaque téléphone juge avec la même règle.
  getPublicState(s) {
    const etape = s.phase === 'essai' ? s.essais[s.index] : null;
    const ids = Object.keys(s.names);
    return {
      phase: s.phase,
      etape,
      index: s.index,
      etapes: s.essais.map((e) => ({ id: e, libelle: LIBELLE_ESSAI[e], icone: ICONE_ESSAI[e] })),
      reglages: {
        dureeSon: s.settings.dureeSon,
        longueurTrait: s.settings.longueurTrait,
        inclinaison: s.settings.inclinaison,
        reprise: s.settings.reprise,
      },
      joueurs: ids.map((id) => ({
        id,
        nom: s.names[id],
        resultats: s.essais.map((e) => s.resultats[id]?.[e] ?? null),
      })),
      repondus: etape ? ids.filter((id) => s.resultats[id]?.[etape] !== undefined).length : 0,
      total: ids.length,
    };
  },

  // Vue privée : seulement l’état du joueur concerné pour l’essai en cours.
  getPlayerState(s, playerId) {
    const etape = s.phase === 'essai' ? s.essais[s.index] : null;
    const reponse = etape ? s.resultats[playerId]?.[etape] : undefined;
    return { etape, aRepondu: reponse !== undefined, monResultat: reponse ?? null };
  },

  // Liste des téléphones qui n’ont pas encore répondu à l’essai en cours.
  getHostState(s) {
    if (s.phase !== 'essai') return { attente: [] as string[] };
    const essai = s.essais[s.index];
    return {
      attente: Object.keys(s.names)
        .filter((id) => s.resultats[id]?.[essai] === undefined)
        .map((id) => s.names[id]),
    };
  },

  isFinished: (s) => s.phase === 'final',
};
