import type { CardGameDefinition, GameNotice } from '@partyhub/shared';

/**
 * Règles pures du Rami 51 : paquet de 108 cartes, valeurs, combinaisons (brelans,
 * carrés, suites) avec la place exacte de chaque joker, ouverture, compléments,
 * échange de joker et pénalités. Le serveur et le téléphone utilisent les mêmes
 * fonctions : une combinaison refusée sur le téléphone l'est aussi sur le serveur.
 *
 * Identifiants : une carte est « rang + couleur » (« 7h » = 7 de cœur, « qs » = dame
 * de pique, « 10d », « ac »…), le joker est « jk ». Deux jeux sont mélangés : chaque
 * carte physique a un identifiant unique (« 7h-1 », « 7h-2 », « jk-3 »).
 *
 * Rangs : 1 (as) à 13 (roi). Dans une suite, la place d'une carte va de 1 (as bas,
 * A-2-3) à 14 (as haut, D-R-A) ; une suite ne fait jamais le tour (R-A-2 interdit).
 */

export type SuitId = 's' | 'h' | 'c' | 'd';

export interface SuitInfo {
  id: SuitId;
  label: string;
  glyph: string;
  color: string;
  red: boolean;
}

/** Couleurs dans l'ordre d'affichage (noir et rouge alternés). */
export const SUITS: readonly SuitInfo[] = [
  { id: 's', label: 'Pique', glyph: '♠', color: '#16162e', red: false },
  { id: 'h', label: 'Cœur', glyph: '♥', color: '#d6293a', red: true },
  { id: 'c', label: 'Trèfle', glyph: '♣', color: '#16162e', red: false },
  { id: 'd', label: 'Carreau', glyph: '♦', color: '#d6293a', red: true },
];

const SUIT_BY_ID = new Map(SUITS.map((s) => [s.id, s]));
const SUIT_ORDER: Record<SuitId, number> = { s: 0, h: 1, c: 2, d: 3 };

/** Identifiant de rang (index + 1 = rang). */
const RANK_IDS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'] as const;
/** Affichage à la française : valet, dame, roi. */
const RANK_SHORT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'] as const;
const RANK_NAMES = [
  'as',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'valet',
  'dame',
  'roi',
] as const;

export const JOKER = 'jk';
export const HAND_SIZE = 13;
export const DECK_SIZE = 108;
export const MAX_RUN = 13;

/** Une carte physique : identifiant unique et carte du paquet qu'elle représente. */
export interface RamiCard {
  uid: string;
  entry: string;
}

export interface CardInfo {
  joker: boolean;
  /** 1 (as) à 13 (roi) ; 0 pour le joker. */
  rank: number;
  suit: SuitId | null;
}

const INFO = new Map<string, CardInfo>();
for (const suit of SUITS) {
  RANK_IDS.forEach((r, i) => INFO.set(`${r}${suit.id}`, { joker: false, rank: i + 1, suit: suit.id }));
}
INFO.set(JOKER, { joker: true, rank: 0, suit: null });

export function cardInfo(entry: string): CardInfo | undefined {
  return INFO.get(entry);
}

export function isJoker(card: { entry: string }): boolean {
  return card.entry === JOKER;
}

export function suitInfo(id: SuitId | null | undefined): SuitInfo | undefined {
  return id ? SUIT_BY_ID.get(id) : undefined;
}

/** Libellé court d'une place (1 et 14 : as ; 11 à 13 : V, D, R). */
export function posLabel(pos: number): string {
  if (pos === 1 || pos === 14) return 'A';
  return RANK_SHORT[pos - 1] ?? '?';
}

/** « 7♥ », « D♠ », « Joker ». */
export function cardLabel(entry: string): string {
  const info = INFO.get(entry);
  if (!info) return '?';
  if (info.joker) return 'Joker';
  return `${RANK_SHORT[info.rank - 1]}${suitInfo(info.suit)?.glyph ?? ''}`;
}

/** « sept de cœur », « dame de pique », « joker » (lecteurs d'écran). */
export function cardName(entry: string): string {
  const info = INFO.get(entry);
  if (!info) return 'carte';
  if (info.joker) return 'joker';
  return `${RANK_NAMES[info.rank - 1]} de ${suitInfo(info.suit)?.label.toLowerCase() ?? ''}`;
}

/** Libellé d'une place dans une couleur : « 7♥ », « A♠ ». */
function placeLabel(pos: number, suit: SuitId): string {
  return `${posLabel(pos)}${suitInfo(suit)?.glyph ?? ''}`;
}

/** Nom pluriel d'un rang, pour « brelan de 7 », « carré de rois ». */
export function rankPlural(pos: number): string {
  if (pos === 1 || pos === 14) return 'as';
  if (pos === 11) return 'valets';
  if (pos === 12) return 'dames';
  if (pos === 13) return 'rois';
  return String(pos);
}

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

/** Valeur d'une carte posée selon sa place : as bas 1, as haut 11, figures 10, sinon sa valeur. */
export function positionValue(pos: number): number {
  if (pos === 1) return 1;
  if (pos === 14) return 11;
  if (pos >= 11) return 10;
  return pos;
}

/** Pénalité d'une carte restée en main : joker 20, as 11, figures 10, sinon sa valeur. */
export function penaltyValue(entry: string): number {
  const info = INFO.get(entry);
  if (!info) return 0;
  if (info.joker) return 20;
  if (info.rank === 1) return 11;
  if (info.rank >= 11) return 10;
  return info.rank;
}

export function handPenalty(cards: readonly { entry: string }[]): number {
  return cards.reduce((sum, c) => sum + penaltyValue(c.entry), 0);
}

// ---------------------------------------------------------------------------
// Paquet
// ---------------------------------------------------------------------------

const DISPLAY_POINTS = (rank: number) => (rank === 1 ? 11 : rank >= 11 ? 10 : rank);

export const RAMI_NOTICE: GameNotice = {
  goal: 'Se débarrasser de toutes ses cartes en posant des combinaisons, et finir la partie avec le moins de points de pénalité.',
  steps: [
    'Deux jeux de 52 cartes et 4 jokers. Chacun reçoit 13 cartes ; la première carte de la pioche lance la défausse.',
    'À votre tour : piochez (pioche ou dessus de la défausse), posez si vous le pouvez, puis défaussez une carte pour finir le tour.',
    'Combinaisons : brelan ou carré (même valeur, couleurs différentes) et suite d’au moins 3 cartes de la même couleur. L’as se place avant le 2 ou après le roi, sans faire le tour (R-A-2 interdit).',
    'Joker : un seul par combinaison, avec au moins deux vraies cartes. Il remplace une carte précise : il comble le trou d’une suite, sinon il la prolonge vers le haut (vers le bas après un as).',
    'Pour ouvrir, posez en une fois des combinaisons d’au moins 51 points (réglable), dont une tierce franche : une suite d’au moins 3 cartes sans joker. Avant d’ouvrir, on pioche et on défausse seulement.',
    'Une fois ouvert, posez d’autres combinaisons, complétez celles de la table (les vôtres comme celles des autres) et échangez un joker contre la carte exacte qu’il remplace.',
    'Une carte prise dans la défausse, comme un joker récupéré, doit être posée sur la table pendant le même tour.',
    'On ne pose jamais sa dernière carte : on la défausse. La manche se termine quand un joueur défausse sa dernière carte.',
    'Les autres comptent leurs cartes en main : joker 20, as 11, figures 10, les autres leur valeur. Rami sec (ouvrir et finir dans le même tour) : pénalités doublées.',
    'La partie s’arrête quand un total atteint 500 points (réglable) : le plus petit total gagne.',
  ],
  tips: [
    'Valeurs pour ouvrir : as 11 (mais 1 dans A-2-3), figures 10, les autres leur valeur ; un joker vaut la carte qu’il remplace.',
    '« Annuler mon tour » reprend les cartes posées depuis la pioche. Si vous avez pris la défausse sans rien poser, la carte y retourne.',
    'Quand la pioche est vide, la défausse (sauf sa carte du dessus) est mélangée pour la remplacer.',
    'Temps écoulé : le joueur pioche puis défausse automatiquement sa carte la plus forte (hors joker).',
    'Un joker posé par un autre joueur peut débloquer votre fin de manche : guettez la carte qu’il remplace.',
  ],
};

/** Définition du paquet au format commun des jeux de cartes (rendu SVG partagé). */
export const RAMI_DEFINITION: CardGameDefinition = {
  name: 'Rami 51',
  description:
    'Le rami à la française : ouvrez à 51 avec une tierce franche, posez tout, et gardez le plus petit total.',
  icon: '♦️',
  theme: 'classique',
  families: SUITS.map((s) => ({ id: s.id, label: s.label, color: s.color })),
  cards: [
    ...SUITS.flatMap((suit) =>
      RANK_IDS.map((r, i) => ({
        id: `${r}${suit.id}`,
        label: RANK_SHORT[i]!,
        symbol: `${RANK_SHORT[i]}${suit.glyph}`,
        family: suit.id,
        effect: 'none' as const,
        count: 2,
        points: DISPLAY_POINTS(i + 1),
      })),
    ),
    { id: JOKER, label: 'Joker', symbol: '★', family: 'wild', effect: 'wild' as const, count: 4, points: 20 },
  ],
  rules: { minPlayers: 2, maxPlayers: 5, handSize: HAND_SIZE, matchOn: 'family', targetScore: 500, turnSeconds: 90 },
  notice: RAMI_NOTICE,
};

/** Les 108 cartes, dans l'ordre (à mélanger). */
export function fullDeck(): RamiCard[] {
  const cards: RamiCard[] = [];
  for (const copy of [1, 2]) {
    for (const suit of SUITS) {
      for (const r of RANK_IDS) cards.push({ uid: `${r}${suit.id}-${copy}`, entry: `${r}${suit.id}` });
    }
  }
  for (let j = 1; j <= 4; j++) cards.push({ uid: `${JOKER}-${j}`, entry: JOKER });
  return cards;
}

// ---------------------------------------------------------------------------
// Combinaisons
// ---------------------------------------------------------------------------

export type MeldKind = 'set' | 'run';

/** Carte d'une combinaison posée. */
export interface MeldCard {
  uid: string;
  entry: string;
  /** Place tenue : 1 (as bas) à 14 (as haut). Pour un joker, celle de la carte qu'il remplace. */
  pos: number;
  /** Joker seulement : couleur(s) qu'il représente (une dans une suite, les couleurs manquantes d'un brelan). */
  stands?: SuitId[];
}

/** Combinaison sur la table. */
export interface Meld {
  id: string;
  owner: string;
  kind: MeldKind;
  /** Ordre d'affichage : suite croissante ; brelan ou carré par couleur, joker en dernier. */
  cards: MeldCard[];
}

export type MeldCheck =
  | {
      ok: true;
      kind: MeldKind;
      cards: MeldCard[];
      points: number;
      /** La combinaison contient un joker. */
      joker: boolean;
      /** Tierce franche : suite sans joker (au moins 3 cartes). */
      franche: boolean;
    }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Liste lisible : « 8♥ », « 8♥ et 9♥ », « 8♥, 9♥, 10♥… ». */
function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length > 3) return `${labels.slice(0, 3).join(', ')}…`;
  return `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
}

function sortSet(cards: MeldCard[]): MeldCard[] {
  const order = (c: MeldCard) => {
    const info = INFO.get(c.entry);
    return info?.joker ? 9 : SUIT_ORDER[info!.suit!];
  };
  return [...cards].sort((a, b) => order(a) - order(b));
}

/** Brelan ou carré : même rang, couleurs toutes différentes ; le joker prend une couleur manquante. */
function solveSet(naturals: RamiCard[], joker: RamiCard | null): MeldCheck {
  const total = naturals.length + (joker ? 1 : 0);
  if (total > 4) return fail('Un brelan compte 3 cartes et un carré 4, pas plus.');
  const rank = INFO.get(naturals[0]!.entry)!.rank;
  const seen = new Set<SuitId>();
  for (const card of naturals) {
    const suit = INFO.get(card.entry)!.suit!;
    if (seen.has(suit)) {
      return fail(`Un brelan ou un carré demande des couleurs différentes : il y a deux ${cardLabel(card.entry)}.`);
    }
    seen.add(suit);
  }
  const pos = rank === 1 ? 14 : rank;
  const cards: MeldCard[] = naturals.map((c) => ({ uid: c.uid, entry: c.entry, pos }));
  if (joker) {
    const stands = SUITS.map((s) => s.id).filter((id) => !seen.has(id));
    cards.push({ uid: joker.uid, entry: joker.entry, pos, stands });
  }
  return {
    ok: true,
    kind: 'set',
    cards: sortSet(cards),
    points: positionValue(pos) * total,
    joker: !!joker,
    franche: false,
  };
}

interface RunItem {
  card: RamiCard;
  joker: boolean;
  /** Rang naturel (1 à 13), 0 pour le joker. */
  rank: number;
  /** Place imposée : carte déjà posée sur la table. */
  fixed?: number;
}

type RunAttempt = { ok: true; cards: MeldCard[]; points: number } | { ok: false; error: string; missing: number };

/** Essaie une place pour chaque carte naturelle ; le joker (s'il est libre) suit la règle de placement. */
function placeRun(naturals: RunItem[], positions: number[], joker: RunItem | null, suit: SuitId): RunAttempt {
  const taken = new Set<number>();
  for (const p of positions) {
    if (taken.has(p))
      return { ok: false, error: `Une suite ne peut pas contenir deux fois le ${placeLabel(p, suit)}.`, missing: 99 };
    taken.add(p);
  }
  if (joker?.fixed !== undefined) {
    if (taken.has(joker.fixed)) {
      return {
        ok: false,
        error: `Le joker remplace déjà le ${placeLabel(joker.fixed, suit)} : utilisez « Échanger le joker ».`,
        missing: 98,
      };
    }
    taken.add(joker.fixed);
  }
  const lo = Math.min(...taken);
  const hi = Math.max(...taken);
  const missing: number[] = [];
  for (let p = lo; p <= hi; p++) if (!taken.has(p)) missing.push(p);

  let jokerPos = joker?.fixed;
  if (joker && jokerPos === undefined) {
    if (missing.length === 1) jokerPos = missing[0]!;
    else if (missing.length === 0) jokerPos = hi < 14 ? hi + 1 : lo - 1;
    else {
      return {
        ok: false,
        error: `Un joker ne comble qu’un seul trou : il manque ${listLabels(missing.map((p) => placeLabel(p, suit)))}.`,
        missing: missing.length - 1,
      };
    }
  } else if (missing.length > 0) {
    return {
      ok: false,
      error: `Ces cartes ne se suivent pas : il manque ${listLabels(missing.map((p) => placeLabel(p, suit)))}.`,
      missing: missing.length,
    };
  }
  if (jokerPos !== undefined && (jokerPos < 1 || jokerPos > 14)) {
    return { ok: false, error: 'Le joker ne trouve pas de place dans cette suite.', missing: 97 };
  }

  const cards: MeldCard[] = naturals.map((n, i) => ({ uid: n.card.uid, entry: n.card.entry, pos: positions[i]! }));
  if (joker && jokerPos !== undefined)
    cards.push({ uid: joker.card.uid, entry: joker.card.entry, pos: jokerPos, stands: [suit] });
  cards.sort((a, b) => a.pos - b.pos);
  if (cards[0]!.pos === 1 && cards[cards.length - 1]!.pos === 14) {
    return { ok: false, error: 'Une suite compte au plus 13 cartes.', missing: 97 };
  }
  return { ok: true, cards, points: cards.reduce((sum, c) => sum + positionValue(c.pos), 0) };
}

/** Toutes les combinaisons de places possibles (un as libre peut être bas ou haut). */
function placements(choices: number[][]): number[][] {
  let out: number[][] = [[]];
  for (const options of choices) {
    const next: number[][] = [];
    for (const prefix of out) for (const p of options) next.push([...prefix, p]);
    out = next.slice(0, 64);
  }
  return out;
}

/** Suite d'une seule couleur. Les cartes déjà posées gardent leur place (`fixed`). */
function solveRun(items: RunItem[], suit: SuitId): MeldCheck {
  if (items.length > MAX_RUN) return fail('Une suite compte au plus 13 cartes.');
  const naturals = items.filter((i) => !i.joker);
  const joker = items.find((i) => i.joker) ?? null;

  // Deux cartes identiques (même rang, même couleur) ne vont jamais dans la même suite.
  const ranks = new Set<number>();
  for (const n of naturals) {
    if (ranks.has(n.rank)) return fail(`Une suite ne peut pas contenir deux fois le ${cardLabel(n.card.entry)}.`);
    ranks.add(n.rank);
  }

  const choices = naturals.map((n) => (n.fixed !== undefined ? [n.fixed] : n.rank === 1 ? [1, 14] : [n.rank]));
  let best: { cards: MeldCard[]; points: number } | null = null;
  let error: { error: string; missing: number } | null = null;
  for (const positions of placements(choices)) {
    const attempt = placeRun(naturals, positions, joker, suit);
    if (attempt.ok) {
      if (!best || attempt.points > best.points) best = attempt;
    } else if (!error || attempt.missing < error.missing) {
      error = attempt;
    }
  }
  if (best) {
    return { ok: true, kind: 'run', cards: best.cards, points: best.points, joker: !!joker, franche: !joker };
  }
  if (wrapsAround([...ranks], joker ? 1 : 0)) {
    return fail('Une suite ne fait pas le tour : l’as se place avant le 2 ou après le roi (R-A-2 est interdit).');
  }
  return fail(error?.error ?? 'Ces cartes ne forment pas une suite.');
}

/**
 * Vrai si les rangs ne se suivent ni avec l'as en bas ni avec l'as en haut,
 * mais se suivraient en passant du roi à l'as puis au 2 (suite qui fait le tour).
 */
function wrapsAround(ranks: number[], jokers: number): boolean {
  if (ranks.length === 0) return false;
  const gaps = (values: number[]) => Math.max(...values) - Math.min(...values) + 1 - values.length;
  if (gaps(ranks) <= jokers || gaps(ranks.map((r) => (r === 1 ? 14 : r))) <= jokers) return false;
  for (let shift = 1; shift < 13; shift++) {
    if (gaps(ranks.map((r) => ((r - 1 + shift) % 13) + 1)) <= jokers) return true;
  }
  return false;
}

/**
 * Valide une nouvelle combinaison et donne la place de chaque carte (joker compris),
 * sa valeur et sa nature. Les cartes peuvent être données dans n'importe quel ordre.
 */
export function checkMeld(cards: readonly RamiCard[]): MeldCheck {
  if (cards.length === 0) return fail('Choisissez des cartes.');
  if (new Set(cards.map((c) => c.uid)).size !== cards.length) return fail('Une carte est choisie deux fois.');
  if (cards.some((c) => !INFO.has(c.entry))) return fail('Carte inconnue.');
  if (cards.length < 3) return fail('Une combinaison compte au moins 3 cartes.');
  const jokers = cards.filter(isJoker);
  if (jokers.length > 1) return fail('Un seul joker par combinaison.');
  const naturals = cards.filter((c) => !isJoker(c));
  if (naturals.length < 2) return fail('Il faut au moins deux vraies cartes à côté du joker.');

  const infos = naturals.map((c) => INFO.get(c.entry)!);
  const sameRank = infos.every((i) => i.rank === infos[0]!.rank);
  if (sameRank) return solveSet(naturals, jokers[0] ?? null);
  const sameSuit = infos.every((i) => i.suit === infos[0]!.suit);
  if (sameSuit) {
    const items: RunItem[] = cards.map((card) => {
      const info = INFO.get(card.entry)!;
      return { card, joker: info.joker, rank: info.rank };
    });
    return solveRun(items, infos[0]!.suit!);
  }
  return fail(
    'Ces cartes ne forment ni un brelan (même valeur, couleurs différentes) ni une suite (même couleur, valeurs qui se suivent).',
  );
}

/** Valeur d'une combinaison posée (le joker vaut la carte qu'il remplace). */
export function meldPoints(cards: readonly MeldCard[]): number {
  return cards.reduce((sum, c) => sum + positionValue(c.pos), 0);
}

/** Couleur d'une suite posée. */
export function runSuit(meld: Pick<Meld, 'cards'>): SuitId | null {
  for (const c of meld.cards) {
    const info = INFO.get(c.entry);
    if (info && !info.joker) return info.suit;
  }
  return meld.cards.find((c) => c.stands?.length)?.stands?.[0] ?? null;
}

/**
 * Ajoute des cartes de la main à une combinaison de la table. Les cartes déjà posées
 * gardent leur place (le joker compris) ; renvoie la combinaison complétée.
 */
export function checkLayoff(meld: Pick<Meld, 'kind' | 'cards'>, added: readonly RamiCard[]): MeldCheck {
  if (added.length === 0) return fail('Choisissez les cartes à ajouter.');
  const uids = [...meld.cards.map((c) => c.uid), ...added.map((c) => c.uid)];
  if (new Set(uids).size !== uids.length) return fail('Une carte est choisie deux fois.');
  if (added.some((c) => !INFO.has(c.entry))) return fail('Carte inconnue.');

  const meldJoker = meld.cards.find(isJoker) ?? null;
  const addedJokers = added.filter(isJoker);
  if (addedJokers.length + (meldJoker ? 1 : 0) > 1) {
    return fail(meldJoker ? 'Cette combinaison a déjà son joker.' : 'Un seul joker par combinaison.');
  }
  const addedNaturals = added.filter((c) => !isJoker(c));

  if (meld.kind === 'set') {
    const pos = meld.cards[0]!.pos;
    const rank = pos === 14 ? 1 : pos;
    for (const card of addedNaturals) {
      if (INFO.get(card.entry)!.rank !== rank) return fail(`Cette combinaison n’accepte que des ${rankPlural(pos)}.`);
    }
    const naturals: RamiCard[] = [...meld.cards.filter((c) => !isJoker(c)), ...addedNaturals];
    const total = naturals.length + (meldJoker || addedJokers.length ? 1 : 0);
    if (total > 4) {
      const replacesJoker =
        meldJoker && addedNaturals.some((c) => meldJoker.stands?.includes(INFO.get(c.entry)!.suit!));
      return fail(
        replacesJoker
          ? 'Le joker tient déjà cette place : utilisez « Échanger le joker ».'
          : 'Un carré compte au plus 4 cartes.',
      );
    }
    return solveSet(naturals, meldJoker ?? addedJokers[0] ?? null);
  }

  const suit = runSuit(meld);
  if (!suit) return fail('Combinaison inconnue.');
  for (const card of addedNaturals) {
    const info = INFO.get(card.entry)!;
    if (info.suit !== suit) {
      return fail(`Cette suite est à ${suitInfo(suit)?.glyph} : le ${cardLabel(card.entry)} ne va pas.`);
    }
    if (
      meldJoker &&
      (info.rank === meldJoker.pos || (info.rank === 1 && (meldJoker.pos === 1 || meldJoker.pos === 14)))
    ) {
      return fail(`Le joker remplace déjà le ${placeLabel(meldJoker.pos, suit)} : utilisez « Échanger le joker ».`);
    }
  }
  const items: RunItem[] = [
    ...meld.cards.map((c) => {
      const info = INFO.get(c.entry)!;
      return {
        card: { uid: c.uid, entry: c.entry },
        joker: info.joker,
        rank: info.joker ? 0 : info.rank,
        fixed: c.pos,
      };
    }),
    ...added.map((card) => {
      const info = INFO.get(card.entry)!;
      return { card, joker: info.joker, rank: info.rank };
    }),
  ];
  return solveRun(items, suit);
}

/** Description du joker d'une combinaison : « 7♥ », ou « 7♦ ou 7♣ » dans un brelan. */
export function jokerText(card: MeldCard): string {
  const stands = card.stands ?? [];
  if (stands.length === 0) return posLabel(card.pos);
  return listLabels(stands.map((s) => placeLabel(card.pos, s))).replace(/ et /, ' ou ');
}

export type SwapCheck = { ok: true; cards: MeldCard[]; joker: RamiCard } | { ok: false; error: string };

/**
 * Échange de joker : la carte de la main doit être exactement celle que le joker remplace
 * (dans un brelan : la bonne valeur, dans une couleur absente). Le joker revient en main.
 */
export function checkSwap(meld: Pick<Meld, 'kind' | 'cards'>, card: RamiCard): SwapCheck {
  const joker = meld.cards.find(isJoker);
  if (!joker) return fail('Cette combinaison n’a pas de joker à échanger.');
  const info = INFO.get(card.entry);
  if (!info) return fail('Carte inconnue.');
  if (info.joker) return fail('Échangez le joker contre une vraie carte.');
  const stands = joker.stands ?? [];
  if (meld.kind === 'run') {
    const rankOk = info.rank === joker.pos || (info.rank === 1 && (joker.pos === 1 || joker.pos === 14));
    if (!rankOk || info.suit !== stands[0]) {
      return fail(`Ce joker remplace le ${jokerText(joker)} : seule cette carte peut le libérer.`);
    }
  } else {
    const rank = joker.pos === 14 ? 1 : joker.pos;
    if (info.rank !== rank || !info.suit || !stands.includes(info.suit)) {
      return fail(`Ce joker remplace le ${jokerText(joker)} : il faut l’une de ces cartes.`);
    }
  }
  const replaced = meld.cards.map((c) =>
    c.uid === joker.uid ? { uid: card.uid, entry: card.entry, pos: joker.pos } : c,
  );
  return {
    ok: true,
    cards: meld.kind === 'set' ? sortSet(replaced) : replaced,
    joker: { uid: joker.uid, entry: joker.entry },
  };
}

export interface OpeningCheck {
  ok: boolean;
  error: string | null;
  /** Total des combinaisons valables. */
  points: number;
  /** Au moins une tierce franche parmi les combinaisons valables. */
  franche: boolean;
  melds: MeldCheck[];
}

/** Ouverture : une ou plusieurs combinaisons posées d'un coup, `threshold` points au moins, dont une tierce franche. */
export function checkOpening(groups: readonly (readonly RamiCard[])[], threshold: number): OpeningCheck {
  const melds = groups.map((g) => checkMeld(g));
  let points = 0;
  let franche = false;
  for (const m of melds) {
    if (!m.ok) continue;
    points += m.points;
    franche ||= m.franche;
  }
  const result = (error: string | null): OpeningCheck => ({ ok: error === null, error, points, franche, melds });
  if (groups.length === 0) return result('Préparez au moins une combinaison pour ouvrir.');
  const uids = groups.flat().map((c) => c.uid);
  if (new Set(uids).size !== uids.length) return result('Une carte est utilisée dans deux combinaisons.');
  const bad = melds.findIndex((m) => !m.ok);
  if (bad >= 0) {
    const m = melds[bad]!;
    return result(groups.length > 1 ? `Combinaison ${bad + 1} : ${m.ok ? '' : m.error}` : m.ok ? '' : m.error);
  }
  if (points < threshold) return result(`Ouverture insuffisante : ${points} points sur ${threshold}.`);
  if (!franche) return result('Il faut au moins une tierce franche pour ouvrir.');
  return result(null);
}

/** Titre d'une combinaison : « Suite 5 à 9 ♥ », « Brelan de 7 », « Carré de rois ». */
export function meldTitle(kind: MeldKind, cards: readonly MeldCard[]): string {
  if (cards.length === 0) return '';
  if (kind === 'set') return `${cards.length === 4 ? 'Carré' : 'Brelan'} de ${rankPlural(cards[0]!.pos)}`;
  const suit = runSuit({ cards: [...cards] });
  return `Suite ${posLabel(cards[0]!.pos)} à ${posLabel(cards[cards.length - 1]!.pos)} ${suitInfo(suit)?.glyph ?? ''}`.trim();
}

export type SortMode = 'suit' | 'rank';

/** Tri de la main pour l'affichage : par couleur puis valeur, ou par valeur puis couleur ; jokers à la fin. */
export function sortCards<T extends { uid: string; entry: string }>(cards: readonly T[], mode: SortMode): T[] {
  const key = (c: T): [number, number, string] => {
    const info = INFO.get(c.entry);
    if (!info || info.joker) return [99, 99, c.uid];
    const suit = SUIT_ORDER[info.suit!];
    return mode === 'suit' ? [suit, info.rank, c.uid] : [info.rank, suit, c.uid];
  };
  return [...cards].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}
