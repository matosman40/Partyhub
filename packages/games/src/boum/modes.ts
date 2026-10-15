import type { BankType } from './bank/types.js';

/**
 * Modes de BOUM ! (phases 1 : texte, vote, cartes). Chaque mode dit de quelle banque il tire,
 * combien d'entrées validées il lui faut, et s'il fait partie du pack Humour noir.
 */

export type Family = 'image' | 'son' | 'tactile' | 'texte' | 'carte' | 'telephone';

export const FAMILY_LABELS: Record<Family, string> = {
  image: 'Image',
  son: 'Son',
  tactile: 'Tactile',
  texte: 'Texte',
  carte: 'Carte',
  telephone: 'Téléphone',
};

/** Couleur d'accent de chaque famille (jetons de la spécification). Le pack Humour noir a la sienne. */
export const FAMILY_COLORS: Record<Family | 'noir', string> = {
  image: '#3ab4ff',
  son: '#b26bff',
  tactile: '#3ddc84',
  texte: '#ffd23f',
  carte: '#2ec4b6',
  telephone: '#ff8c42',
  noir: '#c0172b',
};

/**
 * Forme de la manche :
 * - `reponse` : chacun écrit une réponse, la première juste rapporte le plus ;
 * - `chiffre` : chacun donne un nombre, le plus proche gagne ;
 * - `ecriture_vote` : chacun écrit, puis tout le monde vote sur les réponses anonymes ;
 * - `carte_vote` : chacun joue une carte de sa main, puis tout le monde vote ;
 * - `vote_joueur` : tout le monde vote pour un joueur ;
 * - `vrai_ou_faux` : chacun écrit une affirmation, puis tout le monde vote pour la vraie ;
 * - `detecteur` : un plaideur se défend, les autres le notent ;
 * - `mime` : un joueur mime un métier sans parler, les autres tapent le nom du métier ;
 * - `pays` : chacun choisit un pays sur la carte, selon la distance au bon pays ;
 * - `chanson` : un joueur chante un court extrait sans musique, les autres trouvent l'artiste ou le film.
 */
export type ModeKind =
  | 'reponse'
  | 'chiffre'
  | 'ecriture_vote'
  | 'carte_vote'
  | 'vote_joueur'
  | 'vrai_ou_faux'
  | 'detecteur'
  | 'mime'
  | 'pays'
  | 'chanson'
  | 'mot_secret'
  | 'photo'
  | 'grimace';

/** Durée du mime, en secondes (spécification : le mimeur a 60 secondes). */
export const MIME_SECONDS = 60;

export type ModeId =
  | 'reponse_rapide'
  | 'combien'
  | 'trous_noirs'
  | 'main_sale'
  | 'vrai_ou_faux'
  | 'qui_a_dit_ca'
  | 'epitaphe'
  | 'pire_conseil'
  | 'le_plus_probable'
  | 'detecteur'
  | 'mime_metier'
  | 'ou_est_ce'
  | 'devine_chanson'
  | 'le_mot_secret'
  | 'photo_defi'
  | 'grimace';

export interface ModeNeed {
  type: BankType;
  /** Nombre minimal d'entrées validées, aux niveaux autorisés pour la salle, pour que le mode soit tirable. */
  minValid: number;
}

export interface ModeDef {
  id: ModeId;
  title: string;
  /** Consigne affichée sur l'écran principal et le téléphone. */
  brief: string;
  family: Family;
  kind: ModeKind;
  /** Fait partie du pack Humour noir (activé à la création de la salle). */
  pack: boolean;
  minPlayers: number;
  needs: ModeNeed[];
}

export const MODES: readonly ModeDef[] = [
  {
    id: 'reponse_rapide',
    title: 'Réponse rapide',
    brief: 'Tapez la bonne réponse avant les autres.',
    family: 'texte',
    kind: 'reponse',
    pack: false,
    minPlayers: 2,
    needs: [{ type: 'question', minValid: 5 }],
  },
  {
    id: 'combien',
    title: 'Combien ?',
    brief: 'Donnez le nombre le plus proche de la réponse.',
    family: 'texte',
    kind: 'chiffre',
    pack: false,
    minPlayers: 2,
    needs: [{ type: 'question_chiffre', minValid: 5 }],
  },
  {
    id: 'trous_noirs',
    title: 'Trous noirs',
    brief: 'Complétez les trous de la phrase, le plus drôlement possible.',
    family: 'texte',
    kind: 'ecriture_vote',
    pack: true,
    minPlayers: 2,
    needs: [{ type: 'phrase_trous', minValid: 5 }],
  },
  {
    id: 'main_sale',
    title: 'Main sale',
    brief: 'Jouez la carte qui complète le mieux la phrase.',
    family: 'carte',
    kind: 'carte_vote',
    pack: true,
    minPlayers: 2,
    needs: [
      { type: 'phrase_trous', minValid: 5 },
      { type: 'carte_reponse', minValid: 8 },
    ],
  },
  {
    id: 'vrai_ou_faux',
    title: 'Vrai ou faux',
    brief: 'Écrivez une affirmation. Tout le monde vote pour la vraie.',
    family: 'texte',
    kind: 'vrai_ou_faux',
    pack: true,
    minPlayers: 2,
    needs: [],
  },
  {
    id: 'qui_a_dit_ca',
    title: 'Qui a dit ça ?',
    brief: 'Inventez qui a pu dire cette citation. Le vote décide.',
    family: 'texte',
    kind: 'ecriture_vote',
    pack: true,
    minPlayers: 2,
    needs: [{ type: 'citation', minValid: 5 }],
  },
  {
    id: 'epitaphe',
    title: 'Épitaphe',
    brief: 'Écrivez l’épitaphe la plus drôle pour le sujet proposé.',
    family: 'texte',
    kind: 'ecriture_vote',
    pack: true,
    minPlayers: 2,
    needs: [{ type: 'sujet_epitaphe', minValid: 5 }],
  },
  {
    id: 'pire_conseil',
    title: 'Le pire conseil',
    brief: 'Donnez le pire conseil possible à la personne de la situation.',
    family: 'texte',
    kind: 'ecriture_vote',
    pack: true,
    minPlayers: 2,
    needs: [{ type: 'situation_conseil', minValid: 5 }],
  },
  {
    id: 'le_plus_probable',
    title: 'Le plus probable',
    brief: 'Votez pour le joueur le plus susceptible de faire ça. Pas vous-même.',
    family: 'texte',
    kind: 'vote_joueur',
    pack: true,
    minPlayers: 2,
    needs: [{ type: 'situation', minValid: 5 }],
  },
  {
    id: 'detecteur',
    title: 'Détecteur de mauvaise foi',
    brief: 'Un joueur se justifie. Les autres le notent de 1 à 5 étoiles.',
    family: 'texte',
    kind: 'detecteur',
    pack: true,
    minPlayers: 3,
    needs: [{ type: 'situation', minValid: 5 }],
  },
  {
    id: 'mime_metier',
    title: 'Mime le métier',
    brief: 'Un joueur mime le métier sans parler. Les autres tapent son nom.',
    family: 'telephone',
    kind: 'mime',
    pack: false,
    minPlayers: 3,
    needs: [{ type: 'metier', minValid: 5 }],
  },
  {
    id: 'ou_est_ce',
    title: 'Où est-ce ?',
    brief: 'Indice donné : choisissez le pays sur la liste. Plus vous êtes près, plus vous gagnez.',
    family: 'carte',
    kind: 'pays',
    pack: false,
    minPlayers: 2,
    needs: [{ type: 'pays_indice', minValid: 5 }],
  },
  {
    id: 'devine_chanson',
    title: 'Devine la chanson',
    brief: 'Un joueur chante un extrait, sans musique. Les autres trouvent l’artiste ou le film.',
    family: 'son',
    kind: 'chanson',
    pack: false,
    minPlayers: 3,
    needs: [{ type: 'chanson', minValid: 5 }],
  },
  {
    id: 'le_mot_secret',
    title: 'Le mot secret',
    brief: 'Un joueur voit le mot. Les autres donnent un indice d’un seul mot. Il doit deviner avant la fin du temps.',
    family: 'telephone',
    kind: 'mot_secret',
    pack: false,
    minPlayers: 3,
    needs: [{ type: 'mot_secret', minValid: 5 }],
  },
  {
    id: 'photo_defi',
    title: 'Photo-défi',
    brief: 'Chacun prend une photo qui répond à la consigne. Les autres votent pour la meilleure.',
    family: 'image',
    kind: 'photo',
    pack: false,
    minPlayers: 3,
    needs: [{ type: 'consigne_photo', minValid: 5 }],
  },
  {
    id: 'grimace',
    title: 'Grimace',
    brief: 'Un joueur fait la grimace demandée, en photo. Les autres la notent de 1 à 5 étoiles.',
    family: 'image',
    kind: 'grimace',
    pack: false,
    minPlayers: 3,
    needs: [{ type: 'consigne_photo', minValid: 5 }],
  },
];

export const MODE_BY_ID: Readonly<Record<ModeId, ModeDef>> = Object.fromEntries(
  MODES.map((mode) => [mode.id, mode]),
) as Record<ModeId, ModeDef>;

/** Modes de base (hors pack), toujours disponibles quand leur banque est prête. */
export const BASE_MODE_IDS: readonly ModeId[] = MODES.filter((m) => !m.pack).map((m) => m.id);
