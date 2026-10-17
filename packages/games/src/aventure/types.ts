import type { CombatActionId, SceneKind, StatKey } from './schemas.js';

/** Types de l’état de l’aventure, partagés par le moteur, la progression et le combat. */

export interface Character {
  id: string;
  /** Identifiant dans la bibliothèque du profil, une fois le personnage gardé. Null sinon. */
  libraryId: string | null;
  name: string;
  title: string;
  emoji: string;
  backstory: string;
  stats: Record<StatKey, number>;
  pvMax: number;
  pv: number;
  ability: { name: string; text: string };
  flaw: string;
  /** Objet de départ. */
  item: string;
  /** Objets gagnés pendant l’aventure (quatre au plus, les plus anciens partent d’abord). */
  bag: string[];
  /** Niveau actuel, dérivé de l’expérience et appliqué au fil des gains. */
  level: number;
  /** Expérience totale. */
  xp: number;
  /** Expérience au début de cette partie : le classement ne compte que ce qui a été gagné ici. */
  xpStart: number;
  /** Parties jouées et gagnées avec ce personnage, gardées d’une partie à l’autre. */
  games: number;
  victories: number;
  /** Portrait généré (identifiant d’image), ou null : le personnage est alors dessiné à partir de son nom. */
  portraitId: string | null;
  /** Joueur qui incarne ce personnage, ou null (compagnon de l’aventure, il ne vote pas). */
  ownerId: string | null;
}

/** Personnage secondaire rencontré dans l’histoire. Il est dessiné à partir de son nom. */
export interface Npc {
  name: string;
  title: string;
  emoji: string;
  attitude: string;
  /** Lien avec les aventuriers, de -3 (hostile) à +3 (allié). Il change avec les choix. */
  bond: number;
}

export interface Choice {
  id: string;
  label: string;
  stat: StatKey;
  difficulty: number;
  /** Ce qui arrive si le jet réussit, et si le jet échoue. Gardé secret jusqu’à la résolution du vote. */
  onSuccess: string;
  onFailure: string;
  /** Objet gagné en cas de réussite. */
  item: string | null;
  /** Points de vie rendus en cas de réussite. */
  heal: number;
  /** Points de vie perdus en cas d’échec. */
  risk: number;
  /** Effet sur le lien avec le personnage de la scène, quel que soit le jet. */
  bond: number;
}

export interface SceneNpc extends Npc {
  /** Réplique du personnage à la scène. */
  line: string;
}

export interface SceneState {
  kind: SceneKind;
  title: string;
  text: string;
  hint: string | null;
  npc: SceneNpc | null;
  choices: Choice[];
}

/** Résultat d’un vote : le choix retenu, le jet, la conséquence, et ce que chacun y gagne. */
export interface Resolution {
  sceneTitle: string;
  choiceLabel: string;
  characterId: string;
  characterName: string;
  stat: StatKey;
  roll: number;
  bonus: number;
  total: number;
  difficulty: number;
  success: boolean;
  /** Nombre de voix pour le choix retenu. */
  votes: number;
  /** Vrai quand plusieurs choix étaient à égalité et que le hasard a tranché. */
  tie: boolean;
  consequence: string;
  /** Ce que le résultat change : expérience, niveau, objet, soin, blessure, lien. */
  progress: string[];
}

export interface Foe {
  name: string;
  title: string;
  emoji: string;
  intro: string;
  hp: number;
  hpMax: number;
  /** Difficulté pour le toucher ou le convaincre. */
  defense: number;
  /** Dégâts de sa riposte. */
  damage: number;
  onVictory: string;
  /** Objet trouvé sur l’ennemi après sa défaite. */
  loot: string | null;
}

export interface CombatLine {
  characterId: string;
  characterName: string;
  ownerName: string | null;
  action: CombatActionId;
  label: string;
  roll: number;
  bonus: number;
  total: number;
  defense: number;
  success: boolean;
  text: string;
}

export type RoundOutcome = 'ongoing' | 'victory' | 'defeat' | 'flight';

export interface RoundReport {
  round: number;
  lines: CombatLine[];
  riposte: string | null;
  foeHp: number;
  foeHpMax: number;
  outcome: RoundOutcome;
  /** Ce qui suit la fin du combat (victoire ou fuite de l’ennemi). */
  consequence: string | null;
}

export interface Combat {
  foe: Foe;
  sceneTitle: string;
  /** Manche en cours (à partir de 1). */
  round: number;
  /** `act` : chacun choisit son action. `reveal` : le bilan de la manche s’affiche. */
  step: 'act' | 'reveal';
  /** Action choisie par joueur pour la manche en cours : secrète jusqu’à la résolution. */
  actions: Record<string, CombatActionId>;
  report: RoundReport | null;
  /** Vrai une fois le combat terminé (victoire, fuite ou défaite). */
  over: boolean;
  /** Progression de la dernière manche : expérience, niveaux, butin, soins et blessures. */
  progress: string[];
}

/** Une ligne du déroulé, gardée pour que la suite de l’histoire en tienne compte. */
export interface Recap {
  sceneTitle: string;
  text: string;
}
