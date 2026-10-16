import type { CharacterDraft, EpilogueDraft, RosterDraft, SceneDraft, WorldDraft } from './schemas.js';

/**
 * Histoire de secours : utilisée quand l'IA n'est pas configurée, injoignable ou répond hors format.
 * Tout est tiré au sort dans des réserves écrites à la main : deux parties ne se ressemblent pas.
 * Les pouvoirs sont narratifs : aucun ne modifie les jets, comme dans l'aventure générée.
 */

const WORLDS: WorldDraft[] = [
  {
    title: 'Les Brumes de Valmoret',
    intro:
      'Une ville suspendue au-dessus d’un lac de brouillard. Chaque nuit, une rue disparaît, et avec elle ceux qui y vivaient.',
  },
  {
    title: 'Le Carnaval de Port-Ébène',
    intro:
      'Pendant trois jours, tout le monde porte un masque, les statues comprises. Le maire a disparu avec la clé du trésor.',
  },
  {
    title: 'La Forêt qui Chuchote',
    intro:
      'Les arbres parlent, mais jamais deux fois de la même chose. Un enfant a été emporté par une racine trop curieuse.',
  },
];

const CHARACTERS: CharacterDraft[] = [
  {
    name: 'Mirelle',
    title: 'Cartographe des brumes',
    emoji: '🧭',
    backstory:
      'Elle dessine des cartes qui se modifient toutes seules la nuit. Personne ne sait si c’est un don ou une malédiction.',
    stats: { force: 2, ruse: 4, esprit: 3, charme: 2 },
    pvMax: 8,
    ability: { name: 'Trait de plume', text: 'Elle repère vite les raccourcis que les autres ne voient pas.' },
    flaw: 'Elle se perd dès qu’elle ne regarde pas une carte.',
    item: 'Une boussole qui pointe toujours vers le dessert.',
  },
  {
    name: 'Bernard',
    title: 'Forgeron du village',
    emoji: '🔨',
    backstory: 'Il répare tout, même les promesses. Son marteau siffle quand un mensonge se trouve à proximité.',
    stats: { force: 5, ruse: 1, esprit: 3, charme: 2 },
    pvMax: 10,
    ability: { name: 'Coup de marteau', text: 'Les portes et les pièges n’ont aucune chance contre lui.' },
    flaw: 'Il ne sait pas reculer, même quand il le devrait.',
    item: 'Un marteau qui sent la cannelle.',
  },
  {
    name: 'Ombelle',
    title: 'Diseuse de bonne aventure',
    emoji: '🔮',
    backstory: 'Ses prédictions se réalisent toujours, mais jamais dans le bon ordre.',
    stats: { force: 1, ruse: 3, esprit: 4, charme: 4 },
    pvMax: 6,
    ability: { name: 'Présage', text: 'Elle annonce parfois une issue, avec une certitude qui inquiète.' },
    flaw: 'Elle répond toujours par une énigme.',
    item: 'Un jeu de cartes usées, dont une est blanche.',
  },
  {
    name: 'Sapinette',
    title: 'Renarde pirate',
    emoji: '🦊',
    backstory: 'Elle a quitté la mer après une tempête qu’elle prétend avoir provoquée elle-même.',
    stats: { force: 3, ruse: 4, esprit: 2, charme: 3 },
    pvMax: 8,
    ability: { name: 'Pas de velours', text: 'Elle se glisse partout sans que personne ne l’entende.' },
    flaw: 'Elle ne résiste jamais à un trésor.',
    item: 'Une lunette qui voit à travers les coffres.',
  },
  {
    name: 'Théo',
    title: 'Gardien des livres interdits',
    emoji: '📚',
    backstory: 'Il sait presque tout, mais oublie toujours où il a rangé ses lunettes.',
    stats: { force: 1, ruse: 3, esprit: 5, charme: 2 },
    pvMax: 6,
    ability: { name: 'Mémoire d’éléphant', text: 'Il se souvient d’un détail utile dans chaque situation.' },
    flaw: 'Il s’arrête pour lire tous les panneaux.',
    item: 'Un livre qui murmure des conseils douteux.',
  },
  {
    name: 'Lou',
    title: 'Chanteuse de rue',
    emoji: '🎶',
    backstory: 'Sa voix ouvre les portes des tavernes et ferme la bouche des gardes.',
    stats: { force: 2, ruse: 2, esprit: 2, charme: 5 },
    pvMax: 9,
    ability: { name: 'Refrain entraînant', text: 'Les gens du lieu finissent souvent par fredonner avec elle.' },
    flaw: 'Elle chante quand elle devrait se taire.',
    item: 'Un accordéon à moitié cassé.',
  },
  {
    name: 'Brigitte',
    title: 'Garde-forestière',
    emoji: '🌿',
    backstory: 'Elle connaît chaque sentier et chaque animal, et refuse de couper le moindre arbre.',
    stats: { force: 4, ruse: 2, esprit: 3, charme: 2 },
    pvMax: 10,
    ability: { name: 'Oreille du sous-bois', text: 'Les animaux lui racontent ce qu’ils ont vu, à leur façon.' },
    flaw: 'Elle parle aux arbres, et ils répondent.',
    item: 'Un sifflet d’appel pour les bêtes.',
  },
  {
    name: 'Tic-Tac',
    title: 'Horloger de l’impossible',
    emoji: '⏰',
    backstory: 'Il répare des horloges qui n’existent pas encore. Ses rouages tournent parfois à l’envers.',
    stats: { force: 2, ruse: 4, esprit: 4, charme: 1 },
    pvMax: 7,
    ability: { name: 'Contretemps', text: 'Il devine toujours le moment exact où tout va basculer.' },
    flaw: 'Il ne peut pas s’empêcher de tout démonter.',
    item: 'Une clé à remonter qui fait tic-tac dans les oreilles.',
  },
];

const SCENES: SceneDraft[] = [
  {
    title: 'Le pont qui tremble',
    text: 'Un vieux pont de cordes se balance au-dessus d’un gouffre. De l’autre côté, une lanterne clignote en morse. Il faut traverser avant la nuit.',
    choices: [
      { label: 'Traverser en courant', stat: 'force', difficulty: 12 },
      { label: 'Chercher un passage sous le pont', stat: 'ruse', difficulty: 11 },
      { label: 'Déchiffrer le message de la lanterne', stat: 'esprit', difficulty: 10 },
    ],
  },
  {
    title: 'Le marché des ombres',
    text: 'Des marchands sans visage proposent des souvenirs en échange de vos ombres. L’un d’eux porte la clé du trésor autour du cou.',
    choices: [
      { label: 'Marchander avec le sourire', stat: 'charme', difficulty: 12 },
      { label: 'Voler la clé discrètement', stat: 'ruse', difficulty: 14 },
      { label: 'Défier le marchand à un jeu de dés', stat: 'esprit', difficulty: 11 },
    ],
  },
  {
    title: 'La porte gardée',
    text: 'Une porte massive, surveillée par une statue qui ne cligne jamais des yeux. Elle murmure une énigme à chaque passant.',
    choices: [
      { label: 'Forcer la porte', stat: 'force', difficulty: 13 },
      { label: 'Répondre à l’énigme', stat: 'esprit', difficulty: 12 },
      { label: 'Convaincre la statue de s’écarter', stat: 'charme', difficulty: 13 },
    ],
  },
  {
    title: 'La fête du village',
    text: 'Le village organise une fête en votre honneur. Tout le monde veut vous offrir à boire, et quelqu’un a glissé un papier sous votre verre.',
    choices: [
      { label: 'Danser avec la foule', stat: 'charme', difficulty: 10 },
      { label: 'Lire le papier en secret', stat: 'ruse', difficulty: 12 },
      { label: 'Porter un toast très solennel', stat: 'esprit', difficulty: 9 },
    ],
  },
  {
    title: 'La rivière gelée',
    text: 'La rivière a gelé en une nuit. Sous la glace, une silhouette frappe doucement, comme pour dire bonjour.',
    choices: [
      { label: 'Briser la glace', stat: 'force', difficulty: 11 },
      { label: 'Avancer prudemment sur la glace', stat: 'ruse', difficulty: 13 },
      { label: 'Demander à la silhouette qui elle est', stat: 'esprit', difficulty: 14 },
    ],
  },
  {
    title: 'Le piège du grenier',
    text: 'Dans le grenier poussiéreux, une horloge trace des signes sur le plancher. Quelque chose grince au-dessus de votre tête.',
    choices: [
      { label: 'Démonter le mécanisme', stat: 'force', difficulty: 12 },
      { label: 'Sortir par la lucarne', stat: 'ruse', difficulty: 10 },
      { label: 'Déchiffrer les signes', stat: 'esprit', difficulty: 13 },
    ],
  },
  {
    title: 'Le messager égaré',
    text: 'Un jeune messager pleure au pied d’un arbre. Il a perdu une lettre importante, et des hommes en manteau noir la cherchent aussi.',
    choices: [
      { label: 'Le réconforter', stat: 'charme', difficulty: 9 },
      { label: 'Suivre les hommes en noir', stat: 'ruse', difficulty: 12 },
      { label: 'Retrouver la lettre par la logique', stat: 'esprit', difficulty: 11 },
    ],
  },
  {
    title: 'Le cœur de la forêt',
    text: 'Au centre de la forêt, un arbre immense ouvre une bouche d’écorce. Il demande un souvenir en échange de la vérité.',
    choices: [
      { label: 'Offrir un souvenir heureux', stat: 'charme', difficulty: 11 },
      { label: 'Mentir pour gagner du temps', stat: 'ruse', difficulty: 13 },
      { label: 'Affronter l’arbre en face', stat: 'force', difficulty: 14 },
    ],
  },
];

const VICTORY_ENDINGS: EpilogueDraft[] = [
  {
    title: 'Le retour à la lumière',
    text: 'Le groupe ressort des brumes avec la clé, quelques rires et des cicatrices. Le village ne racontera plus jamais cette nuit sans sourire.',
  },
  {
    title: 'La légende du village',
    text: 'Les histoires racontées au coin du feu changent à chaque veillée, mais une chose reste vraie : vous êtes rentrés, et le trésor est enfin en sûreté.',
  },
];

const DEFEAT_ENDINGS: EpilogueDraft[] = [
  {
    title: 'La nuit l’emporte',
    text: 'À bout de forces, le groupe se retire. Les portes se referment doucement derrière lui, et la ville attend une autre équipe de héros.',
  },
  {
    title: 'Une retraite honorable',
    text: 'Rien ne s’est passé comme prévu, mais chacun est reparti sur ses jambes. Parfois, la plus grande aventure est de savoir quand partir.',
  },
];

/** Tire `count` éléments distincts d'une réserve, avec le générateur injecté. */
function pickDistinct<T>(pool: readonly T[], count: number, random: () => number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < count && left.length > 0) {
    const index = Math.floor(random() * left.length);
    out.push(left.splice(index, 1)[0]!);
  }
  return out;
}

export function fallbackRoster(random: () => number): RosterDraft {
  const world = pickDistinct(WORLDS, 1, random)[0]!;
  return { world, characters: pickDistinct(CHARACTERS, 6, random) };
}

/** Une scène qui n'a pas déjà été jouée dans cette aventure, quand la réserve le permet. */
export function fallbackScene(random: () => number, usedTitles: readonly string[]): SceneDraft {
  const fresh = SCENES.filter((s) => !usedTitles.includes(s.title));
  return pickDistinct(fresh.length > 0 ? fresh : SCENES, 1, random)[0]!;
}

export function fallbackEpilogue(random: () => number, victory: boolean): EpilogueDraft {
  return pickDistinct(victory ? VICTORY_ENDINGS : DEFEAT_ENDINGS, 1, random)[0]!;
}

/** Pour les tests : toutes les scènes de secours ont des choix valides. */
export const FALLBACK_SCENES: readonly SceneDraft[] = SCENES;
