/**
 * Micro-défis : chaque défi dure quelques secondes, tous les joueurs le font en même temps sur leur téléphone.
 * Ce fichier contient les règles de chaque défi et leur jugement. Il est pur : le serveur et les tests s'y
 * réfèrent, et le téléphone calcule exactement les mêmes valeurs (la pose de l'horloge et le marqueur du
 * défi « Pile » sont donnés ici).
 *
 * Un téléphone envoie une valeur (nombre de secousses, durée d'un maintien, angle parcouru…). Le serveur ne
 * peut pas voir le mouvement : il borne la valeur par ce qui est possible dans le temps écoulé.
 */

export type MicrogameId = 'secousse' | 'equilibre' | 'tour' | 'souffle' | 'tapote' | 'pile';

/** Capteur du téléphone qu'un défi utilise. `tap` et `timing` n'ont besoin d'aucun capteur. */
export type MicrogameSensor = 'shake' | 'tilt' | 'spin' | 'mic' | 'tap' | 'timing';

export interface Microgame {
  id: MicrogameId;
  name: string;
  icon: string;
  /** Consigne affichée sur l'écran principal et sur le téléphone, à l'impératif. */
  instruction: string;
  /** Précision courte, sous la consigne. */
  hint: string;
  durationMs: number;
  sensor: MicrogameSensor;
  /** Valeur à atteindre (secousses, millisecondes de maintien, degrés, tapotements…). Absente pour « Pile ». */
  target: number;
}

/** Les six défis, par identifiant. La phase de jeu d'un défi se termine à `durationMs`, même si personne n'a réussi. */
export const MICROGAMES: Record<MicrogameId, Microgame> = {
  secousse: {
    id: 'secousse',
    name: 'Secoue !',
    icon: '📳',
    instruction: 'Secouez votre téléphone !',
    hint: 'Douze secousses franches avant la fin du temps.',
    durationMs: 6000,
    sensor: 'shake',
    target: 12,
  },
  equilibre: {
    id: 'equilibre',
    name: 'Équilibre',
    icon: '🧘',
    instruction: 'Gardez le téléphone à plat, bien droit.',
    hint: 'Tenez le point au centre pendant trois secondes sans bouger.',
    durationMs: 6000,
    sensor: 'tilt',
    target: 3000,
  },
  tour: {
    id: 'tour',
    name: 'Plateau tournant',
    icon: '🌀',
    instruction: 'Faites tourner votre téléphone à plat.',
    hint: 'Un tour complet, comme sur un plateau.',
    durationMs: 6000,
    sensor: 'spin',
    target: 360,
  },
  souffle: {
    id: 'souffle',
    name: 'Souffle !',
    icon: '💨',
    instruction: 'Soufflez dans le micro !',
    hint: 'Un souffle continu d’une seconde et demie. Il faut autoriser le micro.',
    durationMs: 6000,
    sensor: 'mic',
    target: 1500,
  },
  tapote: {
    id: 'tapote',
    name: 'Tapote vite',
    icon: '👆',
    instruction: 'Tapotez l’écran le plus vite possible !',
    hint: 'Vingt tapotements avant la fin du temps.',
    durationMs: 5000,
    sensor: 'tap',
    target: 20,
  },
  pile: {
    id: 'pile',
    name: 'Pile au bon moment',
    icon: '🎯',
    instruction: 'Appuyez quand le curseur est au centre !',
    hint: 'Un seul essai. Le curseur va et vient en continu.',
    durationMs: 6000,
    sensor: 'timing',
    target: 0,
  },
};

export const MICROGAME_IDS = Object.keys(MICROGAMES) as MicrogameId[];

/** Période d'un aller-retour du curseur du défi « Pile », en millisecondes. */
export const PILE_PERIOD_MS = 1200;
/** Demi-largeur de la zone gagnante, sur une échelle de 0 à 1. */
export const PILE_WINDOW = 0.09;

/**
 * Position du curseur du défi « Pile » à l'instant `t` (ms depuis le début du défi), de 0 à 1.
 * Un aller-retour régulier : 0 → 1 → 0 sur `PILE_PERIOD_MS`.
 */
export function pileMarker(t: number): number {
  const phase = (((t % PILE_PERIOD_MS) + PILE_PERIOD_MS) % PILE_PERIOD_MS) / PILE_PERIOD_MS;
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

/** Tolérance de réception : un message peut arriver après le calcul du téléphone (réseau). */
export const LATENCY_SLACK_MS = 400;

export interface Judgement {
  success: boolean;
  points: number;
}

/** Points d'une réussite : 100, plus jusqu'à 60 pour la rapidité. */
export const SUCCESS_POINTS = 100;
export const SPEED_BONUS = 60;

/**
 * Juge la valeur envoyée par un joueur. `elapsedMs` est le temps écoulé côté serveur depuis le début du défi,
 * au moment de la réception. Une valeur impossible dans ce temps est refusée.
 */
export function judge(game: Microgame, value: number, elapsedMs: number): Judgement {
  const elapsed = Math.max(0, elapsedMs);
  const slack = LATENCY_SLACK_MS;
  let success: boolean;
  switch (game.id) {
    case 'secousse':
      // Une secousse ne peut pas être comptée plus vite que toutes les 120 ms.
      success = value >= game.target && value <= 2 + elapsed / 120;
      break;
    case 'equilibre':
      success = value >= game.target && value <= elapsed + slack;
      break;
    case 'tour':
      // Un tour complet ne peut pas se faire en moins de 0,7 seconde.
      success = value >= game.target && elapsed >= 700;
      break;
    case 'souffle':
      success = value >= game.target && value <= elapsed + slack;
      break;
    case 'tapote':
      // Un tapotement ne peut pas être compté plus vite que toutes les 70 ms.
      success = value >= game.target && value <= 2 + elapsed / 70;
      break;
    case 'pile': {
      const inside = Math.abs(pileMarker(value) - 0.5) <= PILE_WINDOW;
      success = inside && value >= 0 && value <= game.durationMs && value <= elapsed + slack;
      break;
    }
  }
  if (!success) return { success: false, points: 0 };
  const speed = Math.max(0, 1 - elapsed / game.durationMs);
  return { success: true, points: SUCCESS_POINTS + Math.round(SPEED_BONUS * speed) };
}

/**
 * Suite des défis d'une partie : un tirage sans répétition (un sac que l'on vide, puis que l'on remplit),
 * sans jamais deux fois le même défi de suite.
 */
export function buildSequence(count: number, random: () => number): MicrogameId[] {
  const out: MicrogameId[] = [];
  let bag: MicrogameId[] = [];
  const fill = () => {
    const last = out[out.length - 1];
    const pool = [...MICROGAME_IDS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    bag = last ? [...pool.filter((id) => id !== last), ...pool.filter((id) => id === last)] : pool;
  };
  while (out.length < count) {
    if (bag.length === 0) fill();
    out.push(bag.shift()!);
  }
  return out;
}

/** Valeur qui réussit le défi (utilisée par les robots du mode test). */
export function winningValue(game: Microgame): number {
  return game.id === 'pile' ? 300 : game.target;
}

/** Valeur qui échoue (utilisée par les robots du mode test). */
export function losingValue(game: Microgame): number {
  switch (game.id) {
    case 'pile':
      return 50;
    case 'secousse':
      return 2;
    case 'tapote':
      return 3;
    default:
      return 0;
  }
}
