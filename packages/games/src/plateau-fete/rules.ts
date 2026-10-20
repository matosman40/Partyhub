import { MICROGAMES, MICROGAME_IDS } from '../micro-defis/microgames.js';

/**
 * Plateau fête : les règles, sans minuteur ni salle. Le module (`module.ts`) enchaîne les phases ; ce fichier décide
 * des cases, des dés, des événements, des choix et des pièces. Tout se teste sans navigateur.
 *
 * Le plateau est un anneau de `RING` cases. Chaque joueur garde une distance parcourue, sans borne : sa case est
 * la distance modulo `RING`, et le classement « qui mène » compare les distances. Une partie dure `TURNS` tours,
 * et un mini-jeu a lieu après chaque tour multiple de `MINIGAME_EVERY`.
 */

/** Nombre de cases de l’anneau. */
export const RING = 60;
/** Nombre de tours de plateau. */
export const TURNS = 40;
/** Un mini-jeu après chaque tour multiple de cette valeur (et avant le dernier tour). */
export const MINIGAME_EVERY = 3;
/** Défis par mini-jeu : chacun tiré dans les six micro-défis, sans répétition de suite. */
export const DEFIS = 5;

/** Pièces de départ, prix d’une étoile, gains et pertes d’une case. */
export const START_COINS = 10;
export const STAR_COST = 20;
export const PIECES_GAIN = 3;
export const PIECES_LOSS = 3;
/** Prime donnée à chaque case « départ » franchie en avançant. */
export const DEPART_BONUS = 2;
/** Déplacement des cases « avance » et « recule ». */
export const SHIFT = 2;

/** Pièces données au classement d’un mini-jeu : 1er, 2e, 3e, 4e. Les suivants reçoivent la participation. */
export const PAYOUTS = [10, 6, 4, 2] as const;
export const PARTICIPATION = 1;

export type CellKind = 'depart' | 'pieces' | 'perte' | 'event' | 'avance' | 'recule' | 'normal';

/** Motif de l’anneau, répété cinq fois : une case « départ », deux événements, deux pertes, trois cases à pièces. */
const CYCLE: readonly CellKind[] = [
  'depart',
  'normal',
  'event',
  'perte',
  'pieces',
  'avance',
  'normal',
  'pieces',
  'recule',
  'event',
  'perte',
  'pieces',
];

export const KINDS: readonly CellKind[] = Array.from({ length: RING }, (_, i) => CYCLE[i % CYCLE.length]!);

/** Les cases où l’étoile peut apparaître : des cases ordinaires ou à pièces, jamais un départ ni un événement. */
export const STAR_SPOTS: readonly number[] = KINDS.flatMap((kind, cell) =>
  kind === 'normal' || kind === 'pieces' ? [cell] : [],
);
/** Nombre d’étoiles sur le plateau à la fois. Chacune change de case après un achat. */
export const STAR_COUNT = 3;

/** Modulo positif : la case d’une distance parcourue. */
export function wrap(distance: number): number {
  return ((distance % RING) + RING) % RING;
}

export function kindAt(cell: number): CellKind {
  return KINDS[wrap(cell)]!;
}

export function rollDie(random: () => number): number {
  return Math.min(6, 1 + Math.floor(random() * 6));
}

/**
 * Déplacement d’une distance (négative : vers l’arrière). `path` liste les distances visitées, une par pas, dans
 * l’ordre (l’écran principal anime ces pas). Chaque case « départ » franchie vers l’avant rapporte la prime.
 */
export function walk(from: number, steps: number): { to: number; path: number[]; bonus: number } {
  const dir = steps >= 0 ? 1 : -1;
  const path: number[] = [];
  let bonus = 0;
  for (let k = 1; k <= Math.abs(steps); k++) {
    const d = from + dir * k;
    path.push(d);
    if (dir > 0 && kindAt(d) === 'depart') bonus += DEPART_BONUS;
  }
  return { to: from + steps, path, bonus };
}

/** Le plus loin devant : premier de la liste en cas d’égalité (ordre d’arrivée). */
export function leaderOf(ids: readonly string[], dist: Record<string, number>): string | null {
  let best: string | null = null;
  for (const id of ids) {
    if (best === null || (dist[id] ?? 0) > (dist[best] ?? 0)) best = id;
  }
  return best;
}

/* ---------- Événements ---------- */

export type EventId = 'pluie' | 'pickpocket' | 'saut' | 'echange' | 'pari' | 'filante';

export interface EventCard {
  id: EventId;
  name: string;
  icon: string;
  text: string;
  weight: number;
}

/** Cartes de la case « événement ». Le pari est la seule carte qui demande un choix au joueur. */
export const EVENTS: readonly EventCard[] = [
  { id: 'pluie', name: 'Pluie de pièces', icon: '🌧️', text: 'Des pièces tombent du ciel : +5 pour vous.', weight: 3 },
  {
    id: 'pickpocket',
    name: 'Pickpocket',
    icon: '🦹',
    text: 'Vous soulevez 4 pièces au joueur le plus riche.',
    weight: 2,
  },
  { id: 'saut', name: 'Le grand saut', icon: '🦘', text: 'Un bond de 3 à 6 cases, au hasard.', weight: 2 },
  {
    id: 'echange',
    name: 'Échange de place',
    icon: '🔄',
    text: 'Vous prenez la place du joueur en tête, qui prend la vôtre.',
    weight: 1,
  },
  { id: 'pari', name: 'Le pari du forain', icon: '🎲', text: 'Tentez le coup, ou jouez prudent.', weight: 3 },
  { id: 'filante', name: 'Étoile filante', icon: '🌠', text: 'Une étoile gratuite pour vous !', weight: 1 },
];

/** Pari : tenter le coup rapporte 6 pièces ou en coûte 3, à pile ou face ; jouer prudent rapporte 1. */
export const PARI = { win: 6, lose: PIECES_LOSS, safe: 1 } as const;
/** Pièces prises par un pickpocket. */
export const PICKPOCKET = 4;
/** Pièces gagnées par la pluie. */
export const RAIN = 5;

export function drawEvent(random: () => number): EventCard {
  const total = EVENTS.reduce((sum, e) => sum + e.weight, 0);
  let pick = random() * total;
  for (const card of EVENTS) {
    pick -= card.weight;
    if (pick < 0) return card;
  }
  return EVENTS[EVENTS.length - 1]!;
}

/** Une saut de 3 à 6 cases. */
export function jumpSteps(random: () => number): number {
  return 3 + Math.floor(random() * 4);
}

/* ---------- Choix ---------- */

export type ChoiceKind = 'etoile' | 'pari';
export type Choice = 'acheter' | 'garder' | 'risque' | 'prudence';

/** Les deux réponses possibles pour chaque sorte de choix. La première est celle du bouton « oui ». */
export const CHOICES: Record<ChoiceKind, readonly [Choice, Choice]> = {
  etoile: ['acheter', 'garder'],
  pari: ['risque', 'prudence'],
};

/** Réponse appliquée quand le joueur ne répond pas à temps. */
export function defaultChoice(kind: ChoiceKind): Choice {
  return kind === 'etoile' ? 'garder' : 'prudence';
}

export function isChoiceFor(kind: ChoiceKind, choice: string): choice is Choice {
  return (CHOICES[kind] as readonly string[]).includes(choice);
}

/* ---------- Classements ---------- */

/** Rang « en compétition » : deux ex æquo partagent le même rang, le suivant saute. */
export function competitionRanks(ids: readonly string[], scores: Record<string, number>): Record<string, number> {
  const sorted = [...ids].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const ranks: Record<string, number> = {};
  let rank = 0;
  let last: number | null = null;
  sorted.forEach((id, i) => {
    const value = scores[id] ?? 0;
    if (last === null || value !== last) rank = i + 1;
    ranks[id] = rank;
    last = value;
  });
  return ranks;
}

export function payoutFor(rank: number): number {
  return PAYOUTS[rank - 1] ?? PARTICIPATION;
}

export interface Standing {
  id: string;
  stars: number;
  coins: number;
  rank: number;
}

/** Classement final : les étoiles d’abord, puis les pièces. */
export function standings(
  ids: readonly string[],
  stars: Record<string, number>,
  coins: Record<string, number>,
): Standing[] {
  const sorted = [...ids].sort((a, b) => (stars[b] ?? 0) - (stars[a] ?? 0) || (coins[b] ?? 0) - (coins[a] ?? 0));
  const out: Standing[] = [];
  let rank = 0;
  let previous: Standing | null = null;
  sorted.forEach((id, i) => {
    const row = { id, stars: stars[id] ?? 0, coins: coins[id] ?? 0, rank: 0 };
    const tied = previous !== null && previous.stars === row.stars && previous.coins === row.coins;
    if (!tied) rank = i + 1;
    row.rank = rank;
    out.push(row);
    previous = row;
  });
  return out;
}

/* ---------- Rythme ---------- */

/**
 * Durées des phases, en millisecondes. Le tour dure le temps d’une phase de chaque sorte ; un choix ou un dé n’allonge
 * jamais le tour au-delà de son maximum (le tour passe dès que tout le monde a répondu).
 */
export const TIMING = {
  intro: 8000,
  banner: 2500,
  /** Le lancer dure au moins ce temps, même si tout le monde a déjà lancé, pour que l’écran principal le montre. */
  rollMin: 4000,
  rollMax: 12000,
  move: 5000,
  choiceMax: 8000,
  resolve: 3500,
  miniIntro: 4000,
  reveal: 2000,
  miniResults: 6000,
  final: 30000,
  /** Durée d’un pas de pion sur l’écran principal. */
  step: 340,
} as const;

/** Durées typiques, pour estimer la partie : un dé lancé en 5 s, un choix en 4 s en moyenne. */
const TYPICAL = { roll: 5000, choice: 4000 } as const;

/** Nombre de mini-jeux : après chaque multiple de `MINIGAME_EVERY` situé avant le dernier tour. */
export function miniGameCount(): number {
  return Math.floor((TURNS - 1) / MINIGAME_EVERY);
}

/**
 * Durée estimée d’une partie, en minutes, pour une table qui joue vite. Le manifeste annonce cette valeur, et un test
 * la garde à 25 minutes.
 */
export function estimatedMinutes(): number {
  const turn = TIMING.banner + TYPICAL.roll + TIMING.move + TYPICAL.choice + TIMING.resolve;
  const durations = MICROGAME_IDS.map((id) => MICROGAMES[id].durationMs);
  const avgDefi = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
  const miniGame = TIMING.miniIntro + DEFIS * (avgDefi + TIMING.reveal) + TIMING.miniResults;
  const total = TURNS * turn + miniGameCount() * miniGame + TIMING.intro + TIMING.final;
  return Math.round(total / 60000);
}
