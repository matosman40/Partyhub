import type { CardEntry, CardFamily, CardGameDefinition } from '@partyhub/shared';

/**
 * Modèles livrés avec l'application : point de départ pour créer un jeu de cartes dans l'administration.
 * Chaque modèle est une définition complète, validée comme une définition saisie à la main. Un modèle
 * n'a aucun lien avec les jeux déjà créés : l'administrateur en fait une copie modifiable.
 */

export interface CardGameTemplate {
  id: string;
  title: string;
  summary: string;
  definition: CardGameDefinition;
}

const notice = (goal: string, steps: string[], tips: string[] = []) => ({ goal, steps, tips });

const rules = (overrides: Partial<CardGameDefinition['rules']> = {}): CardGameDefinition['rules'] => ({
  minPlayers: 2,
  maxPlayers: 6,
  handSize: 7,
  matchOn: 'family',
  targetScore: 100,
  turnSeconds: 30,
  ...overrides,
});

const plain = (
  id: string,
  label: string,
  symbol: string,
  family: string,
  count: number,
  points: number,
  extra: Partial<CardEntry> = {},
): CardEntry => ({ id, label, symbol, family, effect: 'none', count, points, ...extra });

/* ----------------------------- Jeu de 52 cartes ----------------------------- */

const SUITS = [
  { id: 'pique', label: 'Pique', glyph: '♠', color: '#1b1f3b' },
  { id: 'coeur', label: 'Cœur', glyph: '♥', color: '#c1121f' },
  { id: 'carreau', label: 'Carreau', glyph: '♦', color: '#e4572e' },
  { id: 'trefle', label: 'Trèfle', glyph: '♣', color: '#2a7f4f' },
];

const VALUES = [
  { id: 'as', label: 'As', symbol: 'A', points: 1, rank: 1 },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    id: `${n}`,
    label: `${n}`,
    symbol: `${n}`,
    points: n === 10 ? 10 : n,
    rank: n,
  })),
  { id: 'valet', label: 'Valet', symbol: 'V', points: 10, rank: 11 },
  { id: 'dame', label: 'Dame', symbol: 'D', points: 10, rank: 12 },
  { id: 'roi', label: 'Roi', symbol: 'R', points: 10, rank: 13 },
];

const deck52: CardGameDefinition = {
  name: 'Jeu de 52 cartes',
  description: 'Le paquet classique : quatre couleurs, de l’as au roi.',
  icon: '🂡',
  theme: 'classique',
  fontPreset: 'symboles',
  back: { color: '#7a1f2b', pattern: 'quadrillage' },
  families: SUITS.map<CardFamily>((s) => ({ id: s.id, label: s.label, color: s.color })),
  cards: SUITS.flatMap((suit) =>
    VALUES.map((v) =>
      plain(`${suit.id}-${v.id}`, `${v.label} de ${suit.label.toLowerCase()}`, v.symbol, suit.id, 1, v.points, {
        rank: v.rank,
      }),
    ),
  ),
  rules: rules({ handSize: 7, matchOn: 'either', targetScore: 200, turnSeconds: 30, maxPlayers: 6 }),
  notice: notice(
    'Vider sa main en premier. Une carte se pose sur la même couleur ou sur la même valeur.',
    ['Posez une carte de même couleur ou de même valeur que la carte sur la défausse.', 'Sans carte jouable, piochez.'],
    ['Les figures valent 10 points quand elles restent en main à la fin.'],
  ),
};

/* --------------------------------- Tarot ------------------------------------ */

const TAROT_SUITS = [
  { id: 'batons', label: 'Bâtons', color: '#b5651d' },
  { id: 'coupes', label: 'Coupes', color: '#c1121f' },
  { id: 'epees', label: 'Épées', color: '#3a6ea5' },
  { id: 'deniers', label: 'Deniers', color: '#c9a227' },
];

const TAROT_FIGURES = [
  { id: 'as', label: 'As', symbol: 'A', points: 1, rank: 1 },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: `${n}`, label: `${n}`, symbol: `${n}`, points: 0, rank: n })),
  { id: 'valet', label: 'Valet', symbol: 'V', points: 1, rank: 11 },
  { id: 'cavalier', label: 'Cavalier', symbol: 'C', points: 2, rank: 12 },
  { id: 'dame', label: 'Dame', symbol: 'D', points: 3, rank: 13 },
  { id: 'roi', label: 'Roi', symbol: 'R', points: 4, rank: 14 },
];

const tarot: CardGameDefinition = {
  name: 'Tarot',
  description: 'Paquet de 78 cartes : 56 cartes de couleur et 22 atouts.',
  icon: '🃏',
  theme: 'nuit',
  back: { color: '#2b2d42', pattern: 'losanges', label: 'Tarot' },
  families: [{ id: 'atout', label: 'Atout', color: '#6d5dfc' }, ...TAROT_SUITS.map((s) => ({ ...s }))],
  cards: [
    ...Array.from({ length: 21 }, (_, i) =>
      plain(`atout-${i + 1}`, `Atout ${i + 1}`, `${i + 1}`, 'atout', 1, 0, { rank: 100 + i + 1 }),
    ),
    plain('excuse', 'Excuse', '★', 'atout', 1, 5, { rank: 0 }),
    ...TAROT_SUITS.flatMap((suit) =>
      TAROT_FIGURES.map((f) =>
        plain(`${suit.id}-${f.id}`, `${f.label} de ${suit.label.toLowerCase()}`, f.symbol, suit.id, 1, f.points, {
          rank: f.rank,
        }),
      ),
    ),
  ],
  rules: rules({ minPlayers: 3, maxPlayers: 5, handSize: 10, matchOn: 'family', targetScore: 300, turnSeconds: 45 }),
  notice: notice(
    'Se débarrasser de ses cartes en premier, en suivant la couleur ou l’atout.',
    ['Posez une carte de la couleur demandée ou un atout.', 'Sans carte jouable, piochez.'],
    ['Les enchères et la donne du tarot ne sont pas encore gérées : ce modèle fournit le paquet et la défausse.'],
  ),
};

/* --------------------------------- Jetons ----------------------------------- */

const jetons: CardGameDefinition = {
  name: 'Jetons de mise',
  description: 'Jetons à valeur : la valeur de chaque jeton est donnée par ses points.',
  icon: '🪙',
  theme: 'arcade',
  back: { color: '#0b5d3b', pattern: 'pois' },
  families: [
    { id: 'blanc', label: 'Blanc', color: '#f5f5f5' },
    { id: 'rouge', label: 'Rouge', color: '#c1121f' },
    { id: 'vert', label: 'Vert', color: '#2a7f4f' },
    { id: 'noir', label: 'Noir', color: '#111111' },
    { id: 'bleu', label: 'Bleu', color: '#1d4ed8' },
  ],
  cards: [
    plain('jeton-1', 'Jeton 1', '1', 'blanc', 20, 1),
    plain('jeton-5', 'Jeton 5', '5', 'rouge', 20, 5),
    plain('jeton-25', 'Jeton 25', '25', 'vert', 20, 25),
    plain('jeton-50', 'Jeton 50', '50', 'noir', 10, 50),
    plain('jeton-100', 'Jeton 100', '100', 'bleu', 10, 100),
  ],
  rules: rules({ minPlayers: 2, maxPlayers: 8, handSize: 3, matchOn: 'family', targetScore: 2000, turnSeconds: 0 }),
  notice: notice(
    'Modèle de jetons : les valeurs sont les points de chaque jeton.',
    ['Le paquet sert de base de décor et de tirage.'],
    ['Les mises (poker, tarot) ne sont pas encore gérées par un moteur dédié.'],
  ),
};

/* ---------------------------------- Mémos ----------------------------------- */

const memoAnimaux: CardGameDefinition = {
  name: 'Mémo des animaux',
  description: 'Retrouvez les paires d’animaux face cachée.',
  icon: '🐶',
  theme: 'arcade',
  back: { color: '#3f8cff', pattern: 'rayures' },
  families: [{ id: 'animaux', label: 'Animaux', color: '#3f8cff' }],
  cards: [
    plain('chien', 'Chien', '🐶', 'animaux', 2, 1),
    plain('chat', 'Chat', '🐱', 'animaux', 2, 1),
    plain('souris', 'Souris', '🐭', 'animaux', 2, 1),
    plain('lapin', 'Lapin', '🐰', 'animaux', 2, 1),
    plain('renard', 'Renard', '🦊', 'animaux', 2, 1),
    plain('ours', 'Ours', '🐻', 'animaux', 2, 1),
    plain('panda', 'Panda', '🐼', 'animaux', 2, 1),
    plain('grenouille', 'Grenouille', '🐸', 'animaux', 2, 1),
  ],
  rules: rules({
    minPlayers: 2,
    maxPlayers: 6,
    handSize: 3,
    matchOn: 'family',
    targetScore: 100,
    turnSeconds: 20,
    mechanic: 'memory',
  }),
  notice: notice('Trouver le plus de paires.', [
    'Retournez deux cartes.',
    'Une paire trouvée : vous rejouez.',
    'Sinon, c’est au joueur suivant.',
  ]),
};

const CAPITALS = [
  { slug: 'france', country: 'France', capital: 'Paris' },
  { slug: 'italie', country: 'Italie', capital: 'Rome' },
  { slug: 'espagne', country: 'Espagne', capital: 'Madrid' },
  { slug: 'allemagne', country: 'Allemagne', capital: 'Berlin' },
  { slug: 'japon', country: 'Japon', capital: 'Tokyo' },
  { slug: 'bresil', country: 'Brésil', capital: 'Brasília' },
];

const memoCapitales: CardGameDefinition = {
  name: 'Mémo des capitales',
  description: 'Associez chaque pays à sa capitale : deux cartes textuelles reliées par une même paire.',
  icon: '🗺️',
  theme: 'classique',
  fontPreset: 'lisible',
  back: { color: '#1f5f8b', pattern: 'quadrillage' },
  families: [{ id: 'savoir', label: 'Savoir', color: '#7c3aed' }],
  cards: CAPITALS.flatMap((c) => [
    plain(`p-${c.slug}`, 'Pays', c.country.slice(0, 2), 'savoir', 1, 1, { text: c.country, pair: c.slug }),
    plain(`c-${c.slug}`, 'Capitale', c.capital.slice(0, 2), 'savoir', 1, 1, { text: c.capital, pair: c.slug }),
  ]),
  rules: rules({
    minPlayers: 2,
    maxPlayers: 6,
    handSize: 3,
    matchOn: 'family',
    targetScore: 100,
    turnSeconds: 25,
    mechanic: 'memory',
  }),
  notice: notice('Trouver chaque pays avec sa capitale.', [
    'Retournez deux cartes.',
    'Un pays et sa capitale forment une paire.',
    'Une paire trouvée : vous rejouez.',
  ]),
};

/* ------------------------------- Ressemblance -------------------------------- */

const RESEMBLANCE_COLOURS = [
  { id: 'rouge', label: 'Rouge', color: '#e63946' },
  { id: 'bleu', label: 'Bleu', color: '#3a6ea5' },
  { id: 'vert', label: 'Vert', color: '#2a9d5c' },
  { id: 'jaune', label: 'Jaune', color: '#f4c430' },
];

const RESEMBLANCE_SHAPES = [
  { id: 'rond', label: 'Rond', symbol: '●' },
  { id: 'carre', label: 'Carré', symbol: '■' },
  { id: 'triangle', label: 'Triangle', symbol: '▲' },
  { id: 'etoile', label: 'Étoile', symbol: '★' },
];

/** 4 couleurs × 4 formes, deux exemplaires de chaque : 32 cartes, sans effet. */
const ressemblance: CardGameDefinition = {
  name: 'Ressemblance des formes',
  description: 'Touchez la carte du centre dès que vous en avez une qui lui ressemble par la couleur ou la forme.',
  icon: '🔶',
  theme: 'arcade',
  fontPreset: 'symboles',
  back: { color: '#3a6ea5', pattern: 'pois' },
  families: RESEMBLANCE_COLOURS.map(({ id, label, color }) => ({ id, label, color })),
  cards: RESEMBLANCE_COLOURS.flatMap((colour) =>
    RESEMBLANCE_SHAPES.map((shape) =>
      plain(`${colour.id}-${shape.id}`, `${shape.label} ${colour.label.toLowerCase()}`, shape.symbol, colour.id, 2, 1),
    ),
  ),
  rules: rules({
    minPlayers: 2,
    maxPlayers: 6,
    handSize: 5,
    matchOn: 'either',
    targetScore: 50,
    turnSeconds: 15,
    mechanic: 'race',
  }),
  notice: notice('Être le premier à toucher une carte qui ressemble au centre.', [
    'Une carte est posée au centre.',
    'Touchez une carte de votre main qui a la même couleur ou la même forme.',
    'Vous prenez la carte : ses points sont pour vous.',
    'Une fausse touche vous bloque une seconde et demie.',
  ]),
};

/* ----------------------------------- Plis ------------------------------------ */

const PLI_SUITS = [
  { id: 'pique', label: 'Pique', color: '#1b1f3b' },
  { id: 'coeur', label: 'Cœur', color: '#c1121f' },
  { id: 'carreau', label: 'Carreau', color: '#e4572e' },
  { id: 'trefle', label: 'Trèfle', color: '#2a7f4f' },
];

/** Du sept à l’as, avec la valeur de la belote : 30 points par couleur, 120 par manche. */
const PLI_RANKS = [
  { id: 'sept', label: 'Sept', symbol: '7', rank: 7, points: 0 },
  { id: 'huit', label: 'Huit', symbol: '8', rank: 8, points: 0 },
  { id: 'neuf', label: 'Neuf', symbol: '9', rank: 9, points: 0 },
  { id: 'dix', label: 'Dix', symbol: '10', rank: 10, points: 10 },
  { id: 'valet', label: 'Valet', symbol: 'V', rank: 11, points: 2 },
  { id: 'dame', label: 'Dame', symbol: 'D', rank: 12, points: 3 },
  { id: 'roi', label: 'Roi', symbol: 'R', rank: 13, points: 4 },
  { id: 'as', label: 'As', symbol: 'A', rank: 14, points: 11 },
];

/** 4 couleurs × 8 valeurs : 32 cartes, de quoi distribuer 4 joueurs à 8 cartes, sans atout par défaut. */
const plis: CardGameDefinition = {
  name: 'Plis classiques',
  description: 'Jouez la couleur demandée, remportez les plis : les cartes fortes rapportent des points.',
  icon: '🂡',
  theme: 'classique',
  fontPreset: 'lisible',
  back: { color: '#7a1f2b', pattern: 'losanges' },
  families: PLI_SUITS.map(({ id, label, color }) => ({ id, label, color })),
  cards: PLI_SUITS.flatMap((suit) =>
    PLI_RANKS.map((r) =>
      plain(`${suit.id}-${r.id}`, `${r.label} ${suit.label.toLowerCase()}`, r.symbol, suit.id, 1, r.points, {
        rank: r.rank,
      }),
    ),
  ),
  rules: rules({
    minPlayers: 2,
    maxPlayers: 4,
    handSize: 8,
    matchOn: 'family',
    targetScore: 200,
    turnSeconds: 25,
    mechanic: 'trick',
  }),
  notice: notice('Remporter le plus de points en plis.', [
    'Le premier joueur pose une carte.',
    'Les autres jouent la même couleur s’ils le peuvent.',
    'Le pli va à la plus forte carte de la couleur demandée.',
    'Le gagnant prend les points du pli et ouvre le suivant.',
  ]),
};

export const cardGameTemplates: CardGameTemplate[] = [
  {
    id: 'jeu-52',
    title: 'Jeu de 52 cartes',
    summary: 'Quatre couleurs, de l’as au roi. Pour les jeux de défausse classiques.',
    definition: deck52,
  },
  {
    id: 'tarot',
    title: 'Tarot',
    summary: 'Paquet de 78 cartes avec atouts. Les enchères ne sont pas encore gérées.',
    definition: tarot,
  },
  {
    id: 'jetons',
    title: 'Jetons de mise',
    summary: 'Jetons de 1 à 1000 : la valeur est donnée par les points.',
    definition: jetons,
  },
  {
    id: 'memo-animaux',
    title: 'Mémo des animaux',
    summary: 'Huit paires d’emoji à retrouver face cachée.',
    definition: memoAnimaux,
  },
  {
    id: 'memo-capitales',
    title: 'Mémo des capitales',
    summary: 'Pays et capitales en texte : paires reliées par une même étiquette.',
    definition: memoCapitales,
  },
  {
    id: 'ressemblance',
    title: 'Ressemblance des formes',
    summary: 'Quatre couleurs, quatre formes : touchez la carte du centre dès qu’une carte lui ressemble.',
    definition: ressemblance,
  },
  {
    id: 'plis',
    title: 'Plis classiques',
    summary: 'Trente-deux cartes du sept à l’as : jouez la couleur demandée, remportez les plis.',
    definition: plis,
  },
];
