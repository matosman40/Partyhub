/**
 * Sprites des personnages : petits pixels dessinés en code (aucune image).
 * Style « chibi » inspiré des jeux Bomberman : casque blanc, visage clair,
 * corps de la couleur du joueur, bottes sombres. Chaque grille fait 11 x 14.
 *
 * Légende : o contour · w casque · f visage · e yeux · c corps · d ombre du corps
 *           b bottes · . transparent
 */

export const SPRITE_W = 11;
export const SPRITE_H = 14;

export type Grid = readonly string[];

/** Face : visage visible, yeux pour regarder vers le bas. */
const FRONT_IDLE: Grid = [
  '...ooooo...',
  '..owwwwwo..',
  '.owwwwwwwo.',
  '.owfefefwo.',
  '.owfffffwo.',
  '..offfffo..',
  '..occccco..',
  '.owcccccwo.',
  '.owcccccwo.',
  '..obbbbbo..',
  '..ocdcdco..',
  '...ob.bo...',
  '...ob.bo...',
  '...oo.oo...',
];

/** Même personnage, jambe avant décalée : deuxième image de la marche. */
const FRONT_STEP: Grid = [...FRONT_IDLE.slice(0, 11), '..obo.bo...', '..ob...bo..', '..oo...oo..'];

/** Dos : casque plein, pas de visage. */
const BACK_IDLE: Grid = [
  '...ooooo...',
  '..owwwwwo..',
  '.owwwwwwwo.',
  '.owwwwwwwo.',
  '.owwwwwwwo.',
  '..owwwwwo..',
  ...FRONT_IDLE.slice(6),
];

const BACK_STEP: Grid = [...BACK_IDLE.slice(0, 11), '..obo.bo...', '..ob...bo..', '..oo...oo..'];

function normalize(g: Grid): string[] {
  return g.map((r) => r.padEnd(SPRITE_W, '.').slice(0, SPRITE_W));
}

export const FRAMES = {
  front: [normalize(FRONT_IDLE), normalize(FRONT_STEP)] as const,
  back: [normalize(BACK_IDLE), normalize(BACK_STEP)] as const,
};

/**
 * Profil : on part de la face et on ne garde qu'un œil, décalé vers le côté
 * où le personnage regarde. Le dos ne change pas.
 */
export function withFacing(rows: readonly string[], facing: string | undefined): readonly string[] {
  if (facing !== 'left' && facing !== 'right') return rows;
  const EYE_ROW = 3;
  const col = facing === 'right' ? 6 : 4;
  const out = rows.slice();
  const line = (out[EYE_ROW] ?? '').replace(/e/g, 'f');
  out[EYE_ROW] = line.slice(0, col) + 'e' + line.slice(col + 1);
  return out;
}
