import { z } from 'zod';
import { THEME_PAR_DEFAUT, themeDePlateau, type Decor, type Forme, type ThemeId } from './grille-themes.js';

/**
 * Plateau en grille, façon Bomberman, partagé par tous les appareils. Le serveur tient l’état ;
 * les règles sont ici, pures, pour que le serveur, le navigateur et les tests les appliquent pareil.
 *
 * Un personnage se déplace case par case. Il peut :
 * - marcher, et tourner vers la case devant lui ;
 * - pousser une caisse ou un ballon, s’il y a de la place derrière ;
 * - sauter par-dessus la case devant lui, pour atterrir deux cases plus loin (c'est ainsi qu'on monte
 *   sur une plateforme : on ne la rejoint ni en marchant ni en poussant depuis le sol ; ni le pousseur
 *   ni l'objet poussé ne montent. Descendre d'une plateforme au sol reste permis, en marchant ou en poussant) ;
 * - le saut ignore la case survolée : on peut franchir un pilier, un mur, un objet ou un autre personnage.
 *   Seule la case d'atterrissage doit être libre. C'est voulu (règle documentée et figée par les tests) ;
 * - saluer, sur place ;
 * - porter une boîte : la prendre devant lui, la marcher avec lui, puis la poser devant lui.
 *
 * Tout jeu peut réutiliser ce plateau : il suffit de placer ses personnages (`ajouterPersonnage`).
 */

export const GRILLE_LARGEUR = 21;
export const GRILLE_HAUTEUR = 15;
/** Case de plateforme : on y monte en sautant, et on en redescend en marchant. */
export const CASE_PLATEFORME = 'P';

/** Source unique des directions : le type `Direction` et le schéma zod en dérivent. */
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
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
  /** Lignes du décor : `#` mur, `.` sol, `P` plateforme. */
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

export const actionGrilleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('marcher'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('pousser'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('sauter'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('porter'), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ type: z.literal('saluer') }).strict(),
]);

/** Dérivé du schéma : ajouter un variant au schéma seul suffit à le propager aux types. */
export type ActionGrille = z.infer<typeof actionGrilleSchema>;

/**
 * Le contour organique : le rayon du bord dans une direction donnée (1 = le bord du plateau).
 * C’est une forme presque carrée aux coins adoucis (une superellipse), pour que la zone de jeu couvre
 * tout ce qui est visible, avec quelques ondulations pour qu’elle ne soit pas un rectangle parfait.
 */
export function rayonOrganique(theta: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const superellipse = Math.pow(Math.pow(c, 4) + Math.pow(s, 4), -1 / 4);
  return superellipse * (1 + 0.03 * Math.sin(3 * theta + 0.6) + 0.02 * Math.sin(5 * theta + 2.1));
}

/** Vrai si la case (x, y) est dans la forme du plateau. Le carré garde tout ; le disque coupe les coins, le contour organique les adoucit. */
export function formeContient(forme: Forme, largeur: number, hauteur: number, x: number, y: number): boolean {
  if (forme === 'carree') return true;
  const dx = (x - (largeur - 1) / 2) / (largeur / 2 - 1);
  const dy = (y - (hauteur - 1) / 2) / (hauteur / 2 - 1);
  const d = Math.hypot(dx, dy);
  if (forme === 'ronde') return d <= 1;
  return d <= rayonOrganique(Math.atan2(dy, dx));
}

/**
 * Les points du contour de la forme, en coordonnées du monde (x, z), à une marge au-delà des cases libres.
 * Sert à dessiner le sol et les blocs qui le bordent, pour qu’ils suivent exactement la règle.
 */
export function contourDeLaForme(
  forme: Forme,
  largeur: number,
  hauteur: number,
  n: number,
  marge = 0.5,
): Array<[number, number]> {
  const rx = largeur / 2 - 1 + marge;
  const ry = hauteur / 2 - 1 + marge;
  return Array.from({ length: n }, (_, i) => {
    const theta = (i / n) * Math.PI * 2;
    const r = forme === 'organique' ? rayonOrganique(theta) : 1;
    return [r * Math.cos(theta) * rx, r * Math.sin(theta) * ry];
  });
}

/** Cases de départ, dans l’ordre : les coins d’abord, puis le centre-bas. */
function departs(largeur: number, hauteur: number, forme: Forme = 'carree'): Array<[number, number]> {
  if (forme !== 'carree') {
    // Dans une forme courbe, les départs sont à l'intérieur, à l'échelle de la grille, jamais dans les coins.
    const cx = (largeur - 1) / 2;
    const cy = (hauteur - 1) / 2;
    const rx = largeur / 2 - 1;
    const ry = hauteur / 2 - 1;
    const p = (fx: number, fy: number): [number, number] => [Math.round(cx + fx * rx), Math.round(cy + fy * ry)];
    return [p(-0.5, -0.5), p(0.5, 0.5), p(0.5, -0.5), p(-0.5, 0.5), p(0, 0.6), p(0, -0.6)];
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
 * Le décor « bord » ne garde que le contour. Les formes « ronde » et « organique » mettent en mur les cases hors de la forme.
 */
export function creerDecor(largeur: number, hauteur: number, options: { forme?: Forme; decor?: Decor } = {}): string[] {
  const forme = options.forme ?? 'carree';
  const decor = options.decor ?? 'piliers';
  const lignes: string[] = [];
  for (let y = 0; y < hauteur; y++) {
    let ligne = '';
    for (let x = 0; x < largeur; x++) {
      const bord = x === 0 || y === 0 || x === largeur - 1 || y === hauteur - 1;
      if (forme !== 'carree') {
        ligne += bord || !formeContient(forme, largeur, hauteur, x, y) ? '#' : '.';
        continue;
      }
      // Piliers une case sur deux (Bomberman), ou un pilier sur seize pour le décor épars.
      const pilier =
        (decor === 'piliers' && x % 2 === 0 && y % 2 === 0) || (decor === 'epars' && x % 4 === 2 && y % 4 === 2);
      ligne += bord || pilier ? '#' : '.';
    }
    lignes.push(ligne);
  }
  return lignes;
}

/** Vrai près d’un des six points de départ : on n’y pose ni caisse ni plateforme, pour que chacun puisse bouger. */
function protege(x: number, y: number, largeur: number, hauteur: number, forme: Forme): boolean {
  return departs(largeur, hauteur, forme).some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 2);
}

/**
 * Plateformes de 2 × 2 cases, posées au hasard (graine fixe), dans la forme et hors des départs.
 */
function poserPlateformes(decor: string[], largeur: number, hauteur: number, forme: Forme, graine: number): string[] {
  const lignes = decor.map((l) => l.split(''));
  const hasard = generateur(graine);
  let posees = 0;
  for (let essai = 0; essai < 300 && posees < 6; essai++) {
    const x = 2 + Math.floor(hasard() * (largeur - 5));
    const y = 2 + Math.floor(hasard() * (hauteur - 5));
    const cases: Array<[number, number]> = [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ];
    const libre = cases.every(
      ([cx, cy]) =>
        lignes[cy]?.[cx] === '.' &&
        formeContient(forme, largeur, hauteur, cx, cy) &&
        !protege(cx, cy, largeur, hauteur, forme),
    );
    if (!libre) continue;
    for (const [cx, cy] of cases) {
      const ligne = lignes[cy];
      if (ligne) ligne[cx] = CASE_PLATEFORME;
    }
    posees++;
  }
  return lignes.map((l) => l.join(''));
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
  const decor0 = creerDecor(largeur, hauteur, { forme: theme.forme, decor: theme.decor });
  const decor = theme.plateformes
    ? poserPlateformes(decor0, largeur, hauteur, theme.forme, (options.graine ?? 7) + 99)
    : decor0;
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
  // Mélange (Fisher-Yates, même graine) pour répartir boîtes et ballons sur tout le plateau.
  for (let i = reste.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    const a = reste[i]!;
    reste[i] = reste[j]!;
    reste[j] = a;
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

/** Case de décor praticable : sol ou plateforme, dans la grille (ni mur ni dehors). */
function caseOuverte(e: EtatGrille, x: number, y: number): boolean {
  const c = e.decor[y]?.[x];
  return dansLaGrille(e, x, y) && (c === '.' || c === CASE_PLATEFORME);
}

/** Vrai si passer de (x1, y1) à (x2, y2) ferait monter du sol sur une plateforme (il faut sauter). */
function monte(e: EtatGrille, x1: number, y1: number, x2: number, y2: number): boolean {
  return e.decor[y1]?.[x1] === '.' && e.decor[y2]?.[x2] === CASE_PLATEFORME;
}

function solLibre(e: EtatGrille, x: number, y: number): boolean {
  if (!caseOuverte(e, x, y)) return false;
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
      // Une plateforme ne se rejoint pas en marchant depuis le sol : il faut sauter dessus.
      if (monte(e, perso.x, perso.y, cible.x, cible.y) || !solLibre(e, cible.x, cible.y)) {
        // Ni position ni direction ne changent : rien à diffuser, on rend le même état.
        if (perso.dir === action.dir) return { ok: true, etat: e };
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
      if (monte(e, perso.x, perso.y, devant.x, devant.y) || monte(e, devant.x, devant.y, derriere.x, derriere.y)) {
        return { ok: false, erreur: 'Pour monter, sautez.' };
      }
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

/** Vrai si la case (x, y) a au moins un voisin libre où aller. */
function aUnVoisinLibre(e: EtatGrille, x: number, y: number): boolean {
  return DIRECTIONS.some((d) => {
    const v = avance(x, y, d);
    return solLibre(e, v.x, v.y);
  });
}

/**
 * Place un personnage sur la première case de départ libre. Si les six départs sont pris, repli sur une case
 * de sol (jamais une plateforme tant qu’une case de sol est libre) qui a un voisin libre, la plus éloignée
 * des autres personnages.
 */
export function ajouterPersonnage(e: EtatGrille, joueurId: string): EtatGrille {
  if (e.personnages[joueurId]) return e;
  const sol = (x: number, y: number) => e.decor[y]?.[x] === '.' && solLibre(e, x, y);
  let place = departs(e.largeur, e.hauteur, themeDePlateau(e.theme).forme).find(([x, y]) => sol(x, y));
  if (!place) {
    const autres = Object.values(e.personnages);
    const distance = (x: number, y: number) =>
      autres.reduce((m, p) => Math.min(m, Math.abs(p.x - x) + Math.abs(p.y - y)), Infinity);
    const plusLoin = (accepte: (x: number, y: number) => boolean) => {
      let meilleur: [number, number] | undefined;
      let score = -1;
      for (let y = 1; y < e.hauteur - 1; y++) {
        for (let x = 1; x < e.largeur - 1; x++) {
          if (!accepte(x, y)) continue;
          const d = distance(x, y);
          if (d > score) {
            score = d;
            meilleur = [x, y];
          }
        }
      }
      return meilleur;
    };
    place =
      plusLoin((x, y) => sol(x, y) && aUnVoisinLibre(e, x, y)) ??
      plusLoin(sol) ??
      plusLoin((x, y) => solLibre(e, x, y));
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

/** Ce qui se trouve devant un personnage : le mur du plateau, un autre personnage, une plateforme ou l’objet posé. */
export type Devant = 'rien' | 'mur' | 'personnage' | 'plateforme' | NatureObjet;

/** Ce qui est devant le personnage, dans la direction où il regarde. Null si le personnage est inconnu. */
export function devantLePersonnage(e: EtatGrille, joueurId: string): Devant | null {
  const perso = e.personnages[joueurId];
  if (!perso) return null;
  const d = avance(perso.x, perso.y, perso.dir);
  if (!caseOuverte(e, d.x, d.y)) return 'mur';
  if (Object.values(e.personnages).some((p) => p.id !== joueurId && p.x === d.x && p.y === d.y)) return 'personnage';
  const objet = objetA(e, d.x, d.y);
  if (objet) return objet.nature;
  return e.decor[d.y]?.[d.x] === CASE_PLATEFORME ? 'plateforme' : 'rien';
}

/**
 * Le bouton d’action fait ce qu’il faut selon ce qui est devant : porter ou poser une boîte, pousser une
 * caisse ou un ballon. Rien à faire : null. Le navigateur s’en sert pour un seul bouton « Action ».
 */
export function actionContextuelle(e: EtatGrille, joueurId: string): ActionGrille | null {
  const perso = e.personnages[joueurId];
  if (!perso) return null;
  const devant = devantLePersonnage(e, joueurId);
  let action: ActionGrille | null = null;
  if (objetPorte(e, joueurId) || devant === 'boite') action = { type: 'porter', dir: perso.dir };
  else if (devant === 'caisse' || devant === 'ballon') action = { type: 'pousser', dir: perso.dir };
  // Le bouton n’est proposé que si le geste serait accepté (rien derrière une caisse, pas de place pour poser…).
  return action && appliquerAction(e, joueurId, action).ok ? action : null;
}
