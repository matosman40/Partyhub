import type { CardEntry, CardFamily, CardGameDefinition } from '@partyhub/shared';

/**
 * Jeux de cartes intégrés, décrits comme des données. Ils empruntent le même
 * moteur et le même rendu que les jeux créés dans l'administration : ils
 * servent aussi de modèles à dupliquer.
 */

/** Cartes numériques 0 à 9 pour une famille de couleur (style « couleurs & chiffres »). */
function colourNumbers(prefix: string, label: string): CardEntry[] {
  const numbers: CardEntry[] = [];
  for (let n = 0; n <= 9; n++) {
    numbers.push({
      id: `${prefix}${n}`,
      label: `${label} ${n}`,
      symbol: String(n),
      family: prefix,
      effect: 'none',
      count: n === 0 ? 1 : 2,
      points: n,
    });
  }
  return numbers;
}

function colourActions(prefix: string, label: string): CardEntry[] {
  return [
    { id: `${prefix}sk`, label: 'Passe', symbol: '⊘', family: prefix, effect: 'skip', count: 2, points: 20 },
    { id: `${prefix}rv`, label: 'Inversion', symbol: '⇄', family: prefix, effect: 'reverse', count: 2, points: 20 },
    { id: `${prefix}p2`, label: `${label} +2`, symbol: '+2', family: prefix, effect: 'draw2', count: 2, points: 20 },
  ];
}

const couleursFamilies: CardFamily[] = [
  { id: 'r', label: 'Rouge', color: '#ff4d5a' },
  { id: 'j', label: 'Jaune', color: '#ffc83d' },
  { id: 'v', label: 'Vert', color: '#3fd27a' },
  { id: 'b', label: 'Bleu', color: '#3f8cff' },
];

const couleursCards: CardEntry[] = [
  ...couleursFamilies.flatMap((f): CardEntry[] => [...colourNumbers(f.id, f.label), ...colourActions(f.id, f.label)]),
  { id: 'wk', label: 'Joker', symbol: '★', family: 'wild', effect: 'wild', count: 4, points: 50 },
  { id: 'wd4', label: 'Joker +4', symbol: '+4', family: 'wild', effect: 'draw4', count: 4, points: 50 },
];

export const cartesCouleurs: CardGameDefinition = {
  name: 'Couleurs & chiffres',
  description: 'Le classique : suivez la couleur ou le chiffre, et videz votre main le premier.',
  icon: '🃏',
  theme: 'arcade',
  families: couleursFamilies,
  cards: couleursCards,
  rules: {
    minPlayers: 2,
    maxPlayers: 6,
    handSize: 7,
    matchOn: 'either',
    targetScore: 500,
    turnSeconds: 20,
  },
  notice: {
    goal: 'Vider votre main le premier, en posant vos cartes sur la défausse.',
    steps: [
      'Chacun reçoit 7 cartes, la carte du dessus donne la couleur à suivre.',
      'Posez une carte de même couleur ou de même symbole que la carte du dessus.',
      'Sans carte jouable, piochez une carte, puis passez si vous ne pouvez pas la poser.',
      'Un joker se pose toujours et impose la couleur suivante.',
      'Quand vous n’avez plus de cartes, vous marquez les points des cartes restées en main.',
    ],
    tips: ['Gardez vos jokers pour les moments décisifs.', 'Un passe ou un +2 fait perdre son tour au joueur suivant.'],
  },
};

const cocoFamilies: CardFamily[] = [
  { id: 'coco', label: 'Coco', color: '#8b5e3c' },
  { id: 'mangue', label: 'Mangue', color: '#ff9f1c' },
  { id: 'ananas', label: 'Ananas', color: '#f4c430' },
  { id: 'goyave', label: 'Goyave', color: '#ff6f8e' },
];

const cocoCards: CardEntry[] = [
  ...cocoFamilies.flatMap((f): CardEntry[] => {
    const numbers: CardEntry[] = [];
    for (let n = 1; n <= 6; n++) {
      numbers.push({
        id: `${f.id.slice(0, 1)}${n}`,
        label: `${f.label} ${n}`,
        symbol: String(n),
        family: f.id,
        effect: 'none',
        count: 2,
        points: n,
      });
    }
    return [
      ...numbers,
      { id: `${f.id.slice(0, 1)}pa`, label: 'Passe', symbol: '⊘', family: f.id, effect: 'skip', count: 2, points: 10 },
      {
        id: `${f.id.slice(0, 1)}go`,
        label: 'Gourmand',
        symbol: '+2',
        family: f.id,
        effect: 'draw2',
        count: 2,
        points: 10,
      },
    ];
  }),
  { id: 'wcp', label: 'Caprice', symbol: '✦', family: 'wild', effect: 'wild', count: 4, points: 30 },
  { id: 'wfe', label: 'Festin', symbol: '+4', family: 'wild', effect: 'draw4', count: 4, points: 30 },
];

export const blancMangerCoco: CardGameDefinition = {
  name: 'Blanc-manger coco',
  description: 'Une version gourmande et tropicale, à cinq joueurs maximum.',
  icon: '🥥',
  theme: 'coco',
  families: cocoFamilies,
  cards: cocoCards,
  rules: {
    minPlayers: 2,
    maxPlayers: 5,
    handSize: 5,
    matchOn: 'either',
    targetScore: 300,
    turnSeconds: 25,
  },
  notice: {
    goal: 'Être le premier à vider sa corbeille de gourmandises.',
    steps: [
      'Chacun reçoit 5 cartes : une corbeille de fruits et de desserts.',
      'Posez une carte de même fruit ou de même chiffre que la carte du dessus.',
      'Sans carte jouable, piochez puis passez.',
      'Un Caprice ou un Festin se pose toujours et fait choisir le fruit suivant.',
    ],
    tips: [
      'Ceci est une variante thématique : elle ne reproduit pas la version traditionnelle.',
      'Ajustez les règles et les cartes dans l’éditeur de l’administration si besoin.',
    ],
  },
};

/** Jeux de cartes intégrés, identifiés par leur clé de registre. */
export const cardGamePresets = {
  'cartes-couleurs': cartesCouleurs,
  'cartes-coco': blancMangerCoco,
} as const;
