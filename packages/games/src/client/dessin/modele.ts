/**
 * Modèle de l’outil de dessin, sans DOM : traits vectoriels, historique annuler/refaire, zoom et lissage.
 *
 * Le dessin est gardé en vecteurs (des points, pas des pixels) : il reste net à tous les zooms, s’annule
 * sans perte, et la longueur tracée se calcule dans le repère du dessin, donc le zoom ne fausse jamais une règle.
 * Pour les autres jeux, ce module se teste seul (voir `__tests__/dessin-modele.test.ts`).
 */

export type Pinceau = 'stylo' | 'pinceau' | 'marqueur' | 'neon';
export type Mode = 'dessin' | 'gomme';

export interface Point {
  x: number;
  y: number;
}

/** Un trait tracé à main levée. En mode gomme, il efface ce qui est dessous au lieu de le colorer. */
export interface TraitLibre {
  type: 'libre';
  mode: Mode;
  pinceau: Pinceau;
  couleur: string;
  /** Taille de base réglée par l’utilisateur ; chaque pinceau la module. */
  taille: number;
  points: Point[];
}

/** Un petit élément posé d’un seul toucher : une étoile, un cœur, un soleil… */
export interface Tampon {
  type: 'tampon';
  symbole: string;
  x: number;
  y: number;
  /** Taille réglée par l’utilisateur ; la taille réelle se calcule avec `tailleTampon`. */
  taille: number;
  /** Rotation en degrés, pour que deux tampons identiques ne se ressemblent pas tout à fait. */
  rotation: number;
}

export type Element = TraitLibre | Tampon;

export interface Historique {
  elements: Element[];
  /** Éléments annulés, que « refaire » peut remettre, du plus récent au plus ancien. */
  refaits: Element[];
}

export const HISTORIQUE_VIDE: Historique = { elements: [], refaits: [] };

/** Réglages des pinceaux : épaisseur relative, opacité, et lueur pour le néon. */
export const PINCEAUX: Record<Pinceau, { libelle: string; facteur: number; opacite: number; lueur: number }> = {
  stylo: { libelle: 'Stylo', facteur: 0.5, opacite: 1, lueur: 0 },
  pinceau: { libelle: 'Pinceau', facteur: 1.3, opacite: 1, lueur: 0 },
  marqueur: { libelle: 'Marqueur', facteur: 2.2, opacite: 0.55, lueur: 0 },
  neon: { libelle: 'Néon', facteur: 0.7, opacite: 1, lueur: 16 },
};

export const COULEURS = [
  '#ffffff',
  '#ffd166',
  '#ff8c42',
  '#ff5d73',
  '#ff7ac7',
  '#9b7bff',
  '#3ff5e0',
  '#b6ff5c',
  '#4aa3ff',
  '#000000',
] as const;

export const TAMPONS = ['⭐', '❤️', '⚡', '☀️', '☁️', '🌈', '🎉', '😀', '🔥', '🌙', '🌸', '🚀'] as const;

/** Largeur d’un tampon, par rapport à la taille réglée. */
const FACTEUR_TAMPON = 3;

/** Épaisseur réelle d’un trait : la taille réglée, modulée par le pinceau. */
export function epaisseur(trait: TraitLibre): number {
  return trait.taille * PINCEAUX[trait.pinceau].facteur;
}

export function ajouter(h: Historique, element: Element): Historique {
  return { elements: [...h.elements, element], refaits: [] };
}

export function annuler(h: Historique): Historique {
  if (h.elements.length === 0) return h;
  const dernier = h.elements[h.elements.length - 1];
  return { elements: h.elements.slice(0, -1), refaits: [dernier, ...h.refaits] };
}

export function refaire(h: Historique): Historique {
  if (h.refaits.length === 0) return h;
  const [premier, ...reste] = h.refaits;
  return { elements: [...h.elements, premier], refaits: reste };
}

export function toutEffacer(): Historique {
  return HISTORIQUE_VIDE;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Longueur d’un trait en unités du dessin (sans la gomme). */
export function longueurTrait(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Longueur cumulée de l’encre : seuls les traits de dessin comptent, la gomme n’ajoute rien. */
export function longueurEncre(elements: Element[]): number {
  return elements.reduce((total, el) => {
    if (el.type === 'libre' && el.mode === 'dessin') return total + longueurTrait(el.points);
    return total;
  }, 0);
}

/**
 * Segments pour une courbe lisse qui passe par le milieu des points : chaque point sert de point de contrôle,
 * et le tracé s’arrondit entre deux milieux. Évite l’effet « escalier » des lignes droites entre points bruts.
 */
export function segmentsLisses(points: Point[]): { controle: Point; fin: Point }[] {
  const segments: { controle: Point; fin: Point }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    segments.push({ controle: a, fin: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  }
  if (points.length >= 2) {
    const dernier = points[points.length - 1];
    segments.push({ controle: dernier, fin: dernier });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Zoom et déplacement.
// La vue associe au dessin une échelle et un décalage : un point du dessin `m` est à l’écran `m * échelle + décalage`.
// ---------------------------------------------------------------------------

export interface Vue {
  echelle: number;
  decalage: Point;
}

export const VUE_INITIALE: Vue = { echelle: 1, decalage: { x: 0, y: 0 } };
export const ECHELLE_MIN = 1;
export const ECHELLE_MAX = 5;

export function versMonde(vue: Vue, ecran: Point): Point {
  return { x: (ecran.x - vue.decalage.x) / vue.echelle, y: (ecran.y - vue.decalage.y) / vue.echelle };
}

export function versEcran(vue: Vue, monde: Point): Point {
  return { x: monde.x * vue.echelle + vue.decalage.x, y: monde.y * vue.echelle + vue.decalage.y };
}

/** Garde le dessin couvrant la zone : on ne peut pas faire glisser le bord du dessin au milieu de l’écran. */
export function contraindre(vue: Vue, largeur: number, hauteur: number): Vue {
  const minX = largeur - largeur * vue.echelle;
  const minY = hauteur - hauteur * vue.echelle;
  return {
    echelle: vue.echelle,
    decalage: {
      x: Math.min(0, Math.max(minX, vue.decalage.x)),
      y: Math.min(0, Math.max(minY, vue.decalage.y)),
    },
  };
}

export function clamperEchelle(echelle: number): number {
  return Math.min(ECHELLE_MAX, Math.max(ECHELLE_MIN, echelle));
}

/**
 * Nouvelle vue à l’échelle demandée. Le point du dessin qui était sous `ancreDepart` reste sous `ancreArrivee` :
 * avec un seul doigt ou un bouton, les deux ancres sont identiques (zoom centré) ; avec deux doigts, l’ancre
 * d’arrivée suit le milieu entre les doigts, ce qui donne le pincer-déplacer.
 */
export function zoomer(
  vue: Vue,
  echelle: number,
  ancreDepart: Point,
  ancreArrivee: Point,
  largeur: number,
  hauteur: number,
): Vue {
  const e = clamperEchelle(echelle);
  const monde = versMonde(vue, ancreDepart);
  return contraindre(
    {
      echelle: e,
      decalage: { x: ancreArrivee.x - monde.x * e, y: ancreArrivee.y - monde.y * e },
    },
    largeur,
    hauteur,
  );
}

/** Taille réelle d’un tampon posé avec une taille de pinceau donnée. */
export function tailleTampon(taille: number): number {
  return taille * FACTEUR_TAMPON;
}
