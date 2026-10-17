/**
 * Catalogue des thèmes d'aventure. Chaque thème donne le ton au modèle de langage, et un libellé au salon.
 * Les thèmes absurdes sont volontaires : l'histoire doit rester cohérente, même quand le décor ne l'est pas.
 */

export interface Theme {
  id: string;
  label: string;
  /** Description donnée au modèle : décor, ton, ce qui fait le sel de l'histoire. */
  brief: string;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'brumes',
    label: 'Brumes et lanternes',
    brief:
      'Une ville suspendue au-dessus des brumes : mélancolique et féerique, avec des lanternes, des ponts qui disparaissent et des murmures.',
  },
  {
    id: 'carnaval',
    label: 'Carnaval masqué',
    brief: 'Une fête de masques où chacun cache un secret : bal, intrigue, farce et rivalité entre deux troupes.',
  },
  {
    id: 'foret',
    label: 'Forêt qui chuchote',
    brief: 'Une forêt où les arbres parlent, les animaux ont des avis, et les racines ont des projets.',
  },
  {
    id: 'fromagerie',
    label: 'Fromagerie hantée',
    brief:
      'Absurde et villageois : une fromagerie où les fromages murmurent, réclament et se vexent. Enquête de comptoir, rivalités et recettes secrètes.',
  },
  {
    id: 'pigeons',
    label: 'Les pigeons gouvernent',
    brief:
      'Absurde et politique : sur la grande place, un conseil de pigeons a remplacé le conseil municipal. Magouilles de marché, miettes et élections.',
  },
  {
    id: 'vaisseau',
    label: 'Vaisseau rétro',
    brief:
      'Science-fiction rétro et loufoque : un vaisseau des années 1950 a oublié sa destination, son capitaine est un hologramme et la cantine est gérée par un robot.',
  },
];

export const THEME_IDS = THEMES.map((t) => t.id) as [string, ...string[]];

export function themeById(id: string | null | undefined): Theme | null {
  if (!id) return null;
  return THEMES.find((t) => t.id === id) ?? null;
}
