import { z } from 'zod';
import { THEME_PAR_DEFAUT, themeDePlateau, type Decor, type Forme, type ThemeId } from './grille-themes.js';

/**
 * Plateau en grille, façon Bomberman, partagé par tous les appareils. Le serveur tient l’état ;
 * les règles sont ici, pures, pour que le serveur, le navigateur et les tests les appliquent pareil.
 *
 * Un personnage se déplace case par case. Il peut :
 * - marcher, et tourner vers la case devant lui ;
 * - pousser une caisse ou un ballon, s’il y a de la place derrière ;
 * - sauter par-dessus la case devant lui, pour atterrir deux cases plus loin ;
 * - saluer, sur place ;
 * - porter une boîte : la prendre devant lui, la marcher avec lui, puis la poser devant lui.
 *
 * Tout jeu peut réutiliser ce plateau : il suffit de placer ses personnages (`ajouterPersonnage`).
 */

export const GRILLE_LARGEUR = 13;
export const GRILLE_HAUTEUR = 11;

export type Direction = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Caisse et ballon se poussent (la caisse bloque, le ballon aussi). Boîte : on la porte. */
export type NatureObjet = 'caisse' | 'ballon' | 'boite';

export interface ObjetGrille {
  id: string;
  nature: NatureObjet;
  x: number;
  y: number;
  /** Identifiant du personnage qui porte l’objet, ou null. Un objet porté suit son porteur. */
  porte: string | null;
}

/** Attitude du personnage, traduite en pose par le navigateur. */
export type Attitude = 'repos' | 'salut' | 'saut' | 'pousse' | 'porte';

export interface PersonnageGrille {
  id: string;
  x: number;
  y: number;
  dir: Direction;
  attitude: Attitude;
}

export interface EtatGrille {
  largeur: number;
  hauteur: number;
  /** Lignes du décor : `#` mur, `.` sol. */
  decor: string[];
  objets: ObjetGrille[];
  personnages: Record<string, PersonnageGrille>;
  /** Dernier geste accepté : son auteur et son attitude, pour jouer l’animation une seule fois. */
  dernier: { joueur: string; geste: Attitude } | null;
  /** Compteur des gestes acceptés : chaque geste change la valeur, même s’il répète le précédent. */
  seq: number;
  /** Décor du plateau (couleurs et motifs), choisi par le jeu à la création. */
  theme: ThemeId;
}

export type ActionGrille =
  | { type: 'marcher'; dir: Direction }
  | { type: 'pousser'; dir: Direction }
  | { type: 'sauter'; dir: Direction }
  | { type: 'porter'; dir: Direction }
  | { type: 'saluer' };

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

export const actionGrilleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('marcher'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('pousser'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('sauter'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('porter'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('saluer') }).strict(),
]);

/** Cases de départ, dans l’ordre : les coins d’abord, puis le centre-bas. */
function departs(largeur: number, hauteur: number, forme: Forme = 'carree'): Array<[number, number]> {
  if (forme === 'ronde') {
    // Dans l’arène ronde, les départs sont à l’intérieur du disque, jamais dans les coins.
    return [
      [3, 2],
      [largeur - 4, hauteur - 3],
      [largeur - 4, 2],
      [3, hauteur - 3],
      [Math.floor(largeur / 2), hauteur - 3],
      [Math.floor(largeur / 2), 2],
    ];
  }
  return [
    [1, 1],
    [largeur - 2, hauteur - 2],
    [largeur - 2, 1],
    [1, hauteur - 2],
    [Math.floor(largeur / 2), hauteur - 2],
    [Math.floor(largeur / 2), 1],
  ];
}

/** Générateur pseudo-aléatoire déterministe : la même graine donne toujours le même plateau. */
function generateur(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Décor du plateau. Par défaut façon Bomberman : murs extérieurs, et des piliers fixes une case sur deux.
 * Le décor « bord » ne garde que le contour. La forme « ronde » met en mur les cases hors d’un disque.
 */
export function creerDecor(largeur: number, hauteur: number, options: { forme?: Forme; decor?: Decor } = {}): string[] {
  const forme = options.forme ?? 'carree';
  const decor = options.decor ?? 'piliers';
  const cx = (largeur - 1) / 2;
  const cy = (hauteur - 1) / 2;
  const rx = largeur / 2 - 1;
  const ry = hauteur / 2 - 1;
  const lignes: string[] = [];
  for (let y = 0; y < hauteur; y++) {
    let ligne = '';
    for (let x = 0; x < largeur; x++) {
      const bord = x === 0 || y === 0 || x === largeur - 1 || y === hauteur - 1;
      if (forme === 'ronde') {
        const dehors = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1;
        ligne += bord || dehors ? '#' : '.';
        continue;
      }
      const pilier = decor === 'piliers' && x % 2 === 0 && y % 2 === 0;
      ligne += bord || pilier ? '#' : '.';
    }
    lignes.push(ligne);
  }
  return lignes;
}

/** Vrai près d’un coin de départ : on n’y pose pas de caisse, pour que chacun puisse bouger. */
function protege(x: number, y: number, largeur: number, hauteur: number, forme: Forme): boolean {
  return departs(largeur, hauteur, forme)
    .slice(0, 4)
    .some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 2);
}

/**
 * Plateau de départ, sans personnage. Des caisses au hasard (graine fixe), quelques boîtes et ballons.
 * Les coins de départ restent libres.
 */
export function creerGrille(
  options: { graine?: number; largeur?: number; hauteur?: number; theme?: ThemeId } = {},
): EtatGrille {
  const largeur = options.largeur ?? GRILLE_LARGEUR;
  const hauteur = options.hauteur ?? GRILLE_HAUTEUR;
  const theme = themeDePlateau(options.theme);
  const decor = creerDecor(largeur, hauteur, { forme: theme.forme, decor: theme.decor });
  const hasard = generateur(options.graine ?? 7);
  const libres: Array<[number, number]> = [];
  for (let y = 1; y < hauteur - 1; y++) {
    for (let x = 1; x < largeur - 1; x++) {
      if (decor[y]?.[x] === '.' && !protege(x, y, largeur, hauteur, theme.forme)) libres.push([x, y]);
    }
  }
  const objets: ObjetGrille[] = [];
  const ajouter = (nature: NatureObjet, [x, y]: [number, number]) => {
    objets.push({ id: `o${objets.length + 1}`, nature, x, y, porte: null });
  };
  // Le thème règle la part de caisses (un plateau dégagé ou plus encombré) ; le reste sert aux boîtes et aux ballons.
  const densite = theme.densiteCaisses;
  const reste: Array<[number, number]> = [];
  for (const c of libres) {
    if (hasard() < densite) ajouter('caisse', c);
    else reste.push(c);
  }
  reste.slice(0, 3).forEach((c) => ajouter('boite', c));
  reste.slice(3, 5).forEach((c) => ajouter('ballon', c));
  return {
    largeur,
    hauteur,
    decor,
    objets,
    personnages: {},
    dernier: null,
    seq: 0,
    theme: options.theme ?? THEME_PAR_DEFAUT,
  };
}

/** Case devant un point, à `pas` cases dans la direction donnée. */
export function avance(x: number, y: number, dir: Direction, pas = 1): { x: number; y: number } {
  const d = DELTA[dir];
  return { x: x + d.dx * pas, y: y + d.dy * pas };
}

function dansLaGrille(e: EtatGrille, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < e.largeur && y < e.hauteur;
}

function solLibre(e: EtatGrille, x: number, y: number): boolean {
  if (!dansLaGrille(e, x, y) || e.decor[y]?.[x] !== '.') return false;
  if (Object.values(e.personnages).some((p) => p.x === x && p.y === y)) return false;
  return !e.objets.some((o) => o.porte === null && o.x === x && o.y === y);
}

/** Objet posé (non porté) sur une case. */
function objetA(e: EtatGrille, x: number, y: number): ObjetGrille | undefined {
  return e.objets.find((o) => o.porte === null && o.x === x && o.y === y);
}

function objetPorte(e: EtatGrille, joueurId: string): ObjetGrille | undefined {
  return e.objets.find((o) => o.porte === joueurId);
}

export type ResultatGrille = { ok: true; etat: EtatGrille } | { ok: false; erreur: string };

function fin(e: EtatGrille, joueurId: string, patch: Partial<PersonnageGrille>, geste: Attitude): EtatGrille {
  const perso = e.personnages[joueurId];
  if (!perso) return e;
  const porte = objetPorte(e, joueurId) !== undefined;
  const attitude = porte && geste !== 'salut' ? 'porte' : geste;
  return {
    ...e,
    personnages: { ...e.personnages, [joueurId]: { ...perso, ...patch, attitude } },
    dernier: { joueur: joueurId, geste: attitude },
    seq: e.seq + 1,
  };
}

/** Déplace le personnage et l’objet qu’il porte, s’il en porte un. */
function deplacer(e: EtatGrille, joueurId: string, x: number, y: number, dir: Direction, geste: Attitude): EtatGrille {
  const perso = e.personnages[joueurId];
  if (!perso) return e;
  const objets = e.objets.map((o) => (o.porte === joueurId ? { ...o, x, y } : o));
  return fin({ ...e, objets }, joueurId, { x, y, dir }, geste);
}

/** Applique le geste d’un personnage. Une action refusée ne change rien et dit pourquoi. */
export function appliquerAction(e: EtatGrille, joueurId: string, action: ActionGrille): ResultatGrille {
  const perso = e.personnages[joueurId];
  if (!perso) return { ok: false, erreur: 'Personnage inconnu sur ce plateau.' };
  const portant = objetPorte(e, joueurId) !== undefined;

  switch (action.type) {
    case 'saluer':
      return { ok: true, etat: fin(e, joueurId, {}, 'salut') };

    case 'marcher': {
      const cible = avance(perso.x, perso.y, action.dir);
      // Une case bloquée : on tourne seulement, comme pour un personnage qui butte contre un mur.
      if (!solLibre(e, cible.x, cible.y)) {
        return { ok: true, etat: fin(e, joueurId, { dir: action.dir }, 'repos') };
      }
      return { ok: true, etat: deplacer(e, joueurId, cible.x, cible.y, action.dir, 'repos') };
    }

    case 'pousser': {
      if (portant) return { ok: false, erreur: 'Posez d’abord ce que vous portez.' };
      const devant = avance(perso.x, perso.y, action.dir);
      const objet = objetA(e, devant.x, devant.y);
      if (!objet || objet.nature === 'boite') return { ok: false, erreur: 'Rien à pousser devant vous.' };
      const derriere = avance(devant.x, devant.y, action.dir);
      if (!solLibre(e, derriere.x, derriere.y)) return { ok: false, erreur: 'Impossible : un obstacle derrière.' };
      const objets = e.objets.map((o) => (o.id === objet.id ? { ...o, x: derriere.x, y: derriere.y } : o));
      return {
        ok: true,
        etat: fin({ ...e, objets }, joueurId, { x: devant.x, y: devant.y, dir: action.dir }, 'pousse'),
      };
    }

    case 'sauter': {
      if (portant) return { ok: false, erreur: 'Impossible de sauter en portant quelque chose.' };
      const atterrissage = avance(perso.x, perso.y, action.dir, 2);
      if (!solLibre(e, atterrissage.x, atterrissage.y)) return { ok: false, erreur: 'Impossible de sauter ici.' };
      return { ok: true, etat: deplacer(e, joueurId, atterrissage.x, atterrissage.y, action.dir, 'saut') };
    }

    case 'porter': {
      const devant = avance(perso.x, perso.y, action.dir);
      if (portant) {
        const porte = objetPorte(e, joueurId);
        if (!porte || !solLibre(e, devant.x, devant.y)) {
          return { ok: false, erreur: 'Pas de place devant vous pour poser.' };
        }
        const objets = e.objets.map((o) => (o.id === porte.id ? { ...o, porte: null, x: devant.x, y: devant.y } : o));
        return { ok: true, etat: fin({ ...e, objets }, joueurId, { dir: action.dir }, 'repos') };
      }
      const objet = objetA(e, devant.x, devant.y);
      if (!objet) return { ok: false, erreur: 'Rien à porter devant vous.' };
      if (objet.nature !== 'boite') return { ok: false, erreur: 'Trop lourd à porter : poussez-le.' };
      const objets = e.objets.map((o) => (o.id === objet.id ? { ...o, porte: joueurId, x: perso.x, y: perso.y } : o));
      return { ok: true, etat: fin({ ...e, objets }, joueurId, { dir: action.dir }, 'porte') };
    }
  }
}

/** Place un personnage sur la première case de départ libre, ou sur une case libre quelconque. */
export function ajouterPersonnage(e: EtatGrille, joueurId: string): EtatGrille {
  if (e.personnages[joueurId]) return e;
  const depart = departs(e.largeur, e.hauteur, themeDePlateau(e.theme).forme).find(([x, y]) => solLibre(e, x, y));
  let place = depart;
  if (!place) {
    for (let y = 1; y < e.hauteur - 1 && !place; y++) {
      for (let x = 1; x < e.largeur - 1 && !place; x++) {
        if (solLibre(e, x, y)) place = [x, y];
      }
    }
  }
  if (!place) return e;
  const [x, y] = place;
  return {
    ...e,
    personnages: { ...e.personnages, [joueurId]: { id: joueurId, x, y, dir: 'down', attitude: 'repos' } },
  };
}

/** Retire un personnage ; l’objet qu’il portait reste posé là où il était. */
export function retirerPersonnage(e: EtatGrille, joueurId: string): EtatGrille {
  if (!e.personnages[joueurId]) return e;
  const personnages = { ...e.personnages };
  delete personnages[joueurId];
  const objets = e.objets.map((o) => {
    if (o.porte !== joueurId) return o;
    return { ...o, porte: null };
  });
  return { ...e, personnages, objets };
}

/** Pose du corps du personnage pour chaque attitude, telle que le navigateur la dessine. */
export const ATTITUDE_POSE: Record<Attitude, 'idle' | 'wave' | 'joy'> = {
  repos: 'idle',
  porte: 'idle',
  pousse: 'idle',
  salut: 'wave',
  saut: 'joy',
};

/** Ce qui se trouve devant un personnage : le mur du plateau, un autre personnage, ou l’objet posé. */
export type Devant = 'rien' | 'mur' | 'personnage' | NatureObjet;

/** Ce qui est devant le personnage, dans la direction où il regarde. Null si le personnage est inconnu. */
export function devantLePersonnage(e: EtatGrille, joueurId: string): Devant | null {
  const perso = e.personnages[joueurId];
  if (!perso) return null;
  const d = avance(perso.x, perso.y, perso.dir);
  if (!dansLaGrille(e, d.x, d.y) || e.decor[d.y]?.[d.x] !== '.') return 'mur';
  if (Object.values(e.personnages).some((p) => p.id !== joueurId && p.x === d.x && p.y === d.y)) return 'personnage';
  return objetA(e, d.x, d.y)?.nature ?? 'rien';
}

/**
 * Le bouton d’action fait ce qu’il faut selon ce qui est devant : porter ou poser une boîte, pousser une
 * caisse ou un ballon. Rien à faire : null. Le navigateur s’en sert pour un seul bouton « Action ».
 */
export function actionContextuelle(e: EtatGrille, joueurId: string): ActionGrille | null {
  const perso = e.personnages[joueurId];
  if (!perso) return null;
  if (objetPorte(e, joueurId)) return { type: 'porter', dir: perso.dir };
  const devant = devantLePersonnage(e, joueurId);
  if (devant === 'boite') return { type: 'porter', dir: perso.dir };
  if (devant === 'caisse' || devant === 'ballon') return { type: 'pousser', dir: perso.dir };
  return null;
}
