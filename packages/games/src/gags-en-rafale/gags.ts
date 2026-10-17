import { shuffle } from '../common/engine.js';

/**
 * Gags en rafale : une succession de gags absurdes, très courts, façon jeux-éclair loufoques. Tout le monde joue
 * le même gag en même temps, seul ou à plusieurs. Ce fichier contient les gags, leurs règles et leur jugement.
 * Il est pur : le serveur, les tests et le téléphone s'y réfèrent. La position de la mouche est calculée par la
 * même fonction partout, pour que le téléphone et le serveur tombent d'accord.
 *
 * Le téléphone envoie une valeur (durée d'un glissement, instant d'un tap, durée d'un maintien…) et, pour la mouche,
 * l'endroit touché. Le serveur ne voit pas le geste : il borne la valeur par le temps écoulé, comme Micro-Défis.
 * Les robots du mode test jouent avec les valeurs gagnantes ci-dessous, choisies pour rester possibles dans le
 * délai minimal de leur action (0,7 s après le début du gag).
 */

export type GagId = 'crepe' | 'mouche' | 'ballon' | 'patience' | 'statue' | 'gratte';

/** Ce que le joueur fait. Sert à l'écran principal et au téléphone pour choisir la scène. */
export type GagInput = 'swipe' | 'moving-target' | 'press-release' | 'wait' | 'still' | 'scratch';

export interface Gag {
  id: GagId;
  name: string;
  icon: string;
  /** Consigne affichée sur l'écran principal et sur le téléphone. */
  instruction: string;
  /** Précision courte, sous la consigne. */
  hint: string;
  /** Une phrase absurde, lue pendant la présentation du gag. */
  flavor: string;
  /** Ce qu'on dit au bilan : une réussite, un raté. */
  quips: { win: string; lose: string };
  durationMs: number;
  input: GagInput;
}

export const GAGS: Record<GagId, Gag> = {
  crepe: {
    id: 'crepe',
    name: 'Lance la crêpe',
    icon: '🥞',
    instruction: 'Glissez vers le haut, vite : la crêpe doit toucher le plafond !',
    hint: 'Un glissement franc, sur un tiers de l’écran au moins.',
    flavor: 'Une crêpe qui ne vole pas est une crêpe qui a peur.',
    quips: {
      win: 'Elle a touché le plafond. Elle y est toujours.',
      lose: 'Retombée sur le chat. Le chat est furieux.',
    },
    durationMs: 5000,
    input: 'swipe',
  },
  mouche: {
    id: 'mouche',
    name: 'Écrase la mouche',
    icon: '🪰',
    instruction: 'Tapez la mouche là où elle est, pas là où elle était !',
    hint: 'Elle ne reste jamais en place. Un raté ne compte pas : retentez.',
    flavor: 'Cette mouche a pris des cours de danse.',
    quips: {
      win: 'SPLATT. Une mouche de moins, une danseuse de moins aussi.',
      lose: 'Elle vous a fait un clin d’œil, puis elle est partie.',
    },
    durationMs: 6000,
    input: 'moving-target',
  },
  ballon: {
    id: 'ballon',
    name: 'Gonfle le ballon',
    icon: '🎈',
    instruction: 'Maintenez pour gonfler, relâchez quand il est à point !',
    hint: 'Relâchez entre 0,9 et 1,5 seconde : plus tôt, il est minuscule ; plus tard, il éclate.',
    flavor: 'Ce ballon a une taille idéale, et elle est secrète.',
    quips: { win: 'Taille parfaite. Le ballon vous remercie.', lose: 'Pschhh… ou boum. Dans les deux cas, raté.' },
    durationMs: 4500,
    input: 'press-release',
  },
  patience: {
    id: 'patience',
    name: 'Surtout, ne touchez pas',
    icon: '🛑',
    instruction: 'Ne touchez SURTOUT PAS le gros bouton rouge.',
    hint: 'Attendez la fin du gag, les mains sur les genoux. Qui ne touche rien gagne.',
    flavor: 'Un bouton très tentant. Vous êtes au-dessus de ça.',
    quips: { win: 'Vous avez résisté. Le bouton est très déçu.', lose: 'Trop tentant. Le bouton a gagné.' },
    durationMs: 4000,
    input: 'wait',
  },
  statue: {
    id: 'statue',
    name: 'Faites la statue',
    icon: '🗿',
    instruction: 'Immobile ! Le téléphone ne doit plus bouger.',
    hint: 'Tenez-le sans un frémissement pendant une seconde et demie. Il faut le capteur de mouvement.',
    flavor: 'Les statues ne toussent pas. Elles ne se grattent pas non plus.',
    quips: { win: 'Statue de l’année. Les pigeons vous ont cru.', lose: 'Un frémissement, et la statue s’effondre.' },
    durationMs: 5000,
    input: 'still',
  },
  gratte: {
    id: 'gratte',
    name: 'Gratte le ticket',
    icon: '🎟️',
    instruction: 'Grattez tout le ticket pour découvrir le gros lot !',
    hint: 'Passez le doigt partout, jusqu’à ce que la surprise apparaisse.',
    flavor: 'Gagnant, peut-être. Une banane, probablement.',
    quips: {
      win: 'Le gros lot : une banane. Vous êtes riche.',
      lose: 'Le ticket est resté à moitié gratté. La banane s’est enfuie.',
    },
    durationMs: 6000,
    input: 'scratch',
  },
};

export const GAG_IDS = Object.keys(GAGS) as GagId[];

/** Tolérance de réception : un message peut arriver après le calcul du téléphone (réseau). */
export const LATENCY_SLACK_MS = 400;

/** Glissement : distance minimale, en part de la hauteur de l'aire de jeu, et durée humaine minimale. */
export const CREPE_SWIPE_RATIO = 0.33;
export const CREPE_MIN_MS = 180;

/** Mouche : rayon de la zone qui écrase, sur une échelle de 0 à 1, et mouvement de la mouche. */
export const FLY_RADIUS = 0.11;

/** Ballon : fenêtre de relâchement, en millisecondes de maintien. */
export const BALLOON_MIN_MS = 900;
export const BALLOON_MAX_MS = 1500;

/** Statue : maintien immobile requis, et accélération (m/s², sans la pesanteur) sous laquelle le téléphone est immobile. */
export const STATUE_MS = 1500;
export const STILL_ACCEL = 0.5;

/** Gratte : durée minimale du grattage, et part du ticket à découvrir. */
export const SCRATCH_MIN_MS = 600;
export const SCRATCH_SHARE = 0.7;

export const SUCCESS_POINTS = 100;
export const SPEED_BONUS = 60;

/** Ce qu'envoie un téléphone : une valeur (ms), et pour la mouche l'endroit touché (de 0 à 1). */
export interface Answer {
  value: number;
  x?: number;
  y?: number;
}

export interface Judgement {
  success: boolean;
  points: number;
}

const LOSE: Judgement = { success: false, points: 0 };

function fraction(v: number): number {
  return v - Math.floor(v);
}

/**
 * Position de la mouche à l'instant `t` (ms depuis le début du gag), de 0 à 1 sur chaque axe. Une courbe de Lissajous
 * dont les phases dépendent de la graine du gag : deux gags ne bougent jamais pareil.
 */
export function flyAt(seed: number, t: number): { x: number; y: number } {
  const a = fraction(seed * 0.618034) * Math.PI * 2;
  const b = fraction(seed * 0.414214) * Math.PI * 2;
  const time = Math.max(0, t);
  return {
    x: 0.5 + 0.3 * Math.sin(time / 600 + a),
    y: 0.5 + 0.24 * Math.sin(time / 420 + b),
  };
}

/** Vrai si le point touché à l'instant `t` écrase la mouche. Le téléphone et le serveur utilisent cette même règle. */
export function isFlyHit(seed: number, t: number, x: number, y: number): boolean {
  const fly = flyAt(seed, t);
  return Math.hypot(x - fly.x, y - fly.y) <= FLY_RADIUS;
}

/** Points d'une réussite : 100, plus jusqu'à 60 pour la rapidité. */
function won(elapsed: number, gag: Gag): Judgement {
  const speed = Math.max(0, 1 - elapsed / gag.durationMs);
  return { success: true, points: SUCCESS_POINTS + Math.round(SPEED_BONUS * speed) };
}

/**
 * Juge la réponse d'un joueur. `elapsedMs` est le temps écoulé côté serveur depuis le début du gag, à la réception.
 * Une valeur impossible dans ce temps, ou un tap sur un gag d'attente, est un raté.
 */
export function judge(gag: Gag, answer: Answer, elapsedMs: number, seed: number): Judgement {
  // « Surtout, ne touchez pas » : toucher, c'est perdre. Ne rien faire réussit (voir silentOutcome).
  if (gag.input === 'wait') return LOSE;
  const elapsed = Math.max(0, elapsedMs);
  const slack = LATENCY_SLACK_MS;
  const v = answer.value;
  let success: boolean;
  switch (gag.id) {
    case 'crepe':
      success = v >= CREPE_MIN_MS && v <= gag.durationMs && v <= elapsed + slack;
      break;
    case 'mouche':
      success =
        answer.x !== undefined &&
        answer.y !== undefined &&
        isFlyHit(seed, v, answer.x, answer.y) &&
        v >= 0 &&
        v <= gag.durationMs &&
        v <= elapsed + slack;
      break;
    case 'ballon':
      success = v >= BALLOON_MIN_MS && v <= BALLOON_MAX_MS && v <= elapsed + slack;
      break;
    case 'statue':
      success = v >= STATUE_MS && v <= elapsed + slack;
      break;
    case 'gratte':
      success = v >= SCRATCH_MIN_MS && v <= gag.durationMs && v <= elapsed + slack;
      break;
    default:
      success = false;
  }
  return success ? won(elapsed, gag) : LOSE;
}

/** Résultat de qui n'a rien envoyé quand le temps est écoulé : réussi pour un gag d'attente, raté sinon. */
export function silentOutcome(gag: Gag): Judgement {
  return gag.input === 'wait' ? won(gag.durationMs, gag) : LOSE;
}

/** Réponse qui réussit le gag (utilisée par les robots). Null quand il suffit de ne rien faire. */
export function winningAnswer(gag: Gag, seed: number): Answer | null {
  switch (gag.id) {
    case 'crepe':
      return { value: 700 };
    case 'mouche': {
      const fly = flyAt(seed, 800);
      return { value: 800, x: fly.x, y: fly.y };
    }
    case 'ballon':
      return { value: 1000 };
    case 'statue':
      return { value: STATUE_MS };
    case 'gratte':
      return { value: 900 };
    case 'patience':
      return null;
  }
}

/** Réponse qui échoue le gag (utilisée par les robots). */
export function losingAnswer(gag: Gag): Answer {
  switch (gag.id) {
    case 'mouche':
      return { value: 800, x: 0, y: 0 };
    case 'ballon':
      return { value: 300 };
    case 'patience':
      return { value: 200 };
    default:
      return { value: 0 };
  }
}

/**
 * Suite des gags d'une partie : un tirage sans répétition (un sac que l'on vide, puis que l'on remplit),
 * sans jamais deux fois le même gag de suite.
 */
export function buildSequence(count: number, random: () => number): GagId[] {
  const out: GagId[] = [];
  let bag: GagId[] = [];
  while (out.length < count) {
    if (bag.length === 0) {
      const last = out[out.length - 1];
      const pool = shuffle(GAG_IDS, random);
      // Le gag qui vient juste de passer passe en dernier dans le sac : il ne revient pas tout de suite.
      bag = last ? [...pool.filter((id) => id !== last), ...pool.filter((id) => id === last)] : pool;
    }
    out.push(bag.shift()!);
  }
  return out;
}
