import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ATTITUDE_POSE,
  CASE_PLATEFORME,
  contourDeLaForme,
  formeContient,
  themeDePlateau,
  type EtatGrille,
  type ObjetGrille,
  type PersonnageGrille,
  type ThemeId,
  type ThemePlateau,
} from '@partyhub/shared';
import { Character, usePrefersReducedMotion, type GrilleApparence } from '@partyhub/games/client';
import { canvasTexture } from './canvas-texture';
import { Environnement, Murs, cieDe, hasard, socleDe } from './Ambiance3D';
import { Forme, GEO } from './Forme';
import {
  texBois,
  texFeuillage,
  texFiletMaille,
  texGlace,
  texHerbe,
  texPierre,
  texPrises,
  touffesHerbe,
} from './materiaux';

/**
 * Plateau en grille en 3D, plein écran sur la TV, dans le style d’un jeu de plateau de fête : matières
 * peintes, contours sombres, ombres nettes, brume au loin et un léger halo sur les lumières. Le lieu
 * (pelouse, mer, plateforme) est décrit par le thème. Les personnages restent les dessins 2D de leur
 * profil, posés sur le plateau ; leur place à l’écran suit la caméra.
 *
 * Réutilisable par tout jeu qui a un plateau en grille (voir `shared/grille.ts`).
 */

const RAYON_BALLON = 0.3;
const TAILLE_BOITE = 0.55;
const TAILLE_CAISSE = 0.78;
/** Hauteur où la boîte portée est tenue, au-dessus du sol (en tête du porteur). */
const HAUTEUR_TETE = 1.3;
/** Saut : durée et hauteur maximale, en unités du plateau. */
const DUREE_SAUT = 0.5;
const HAUTEUR_SAUT = 0.7;
/** Hauteur d’une plateforme : on monte dessus en sautant. */
const HAUTEUR_PLATEFORME = 0.5;
/** Vitesse de glissement vers la case d’arrivée (par seconde, approx.). */
const VITESSE = 12;
/**
 * Ombres : `true` choisirait PCFSoftShadowMap, retiré de three r186 (avertissement), d’où PCFShadowMap.
 * Elles ne se mettent pas à jour seules (`autoUpdate: false`) : la scène est presque immobile, `Monde`
 * demande un nouveau calcul quand une caisse, un ballon ou une boîte bouge, ou que le décor change.
 * L’objet est constant : R3F ne le réapplique pas à chaque rendu.
 */
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap, autoUpdate: false };
/** Résolution : au plus 1,5 pixel par pixel CSS, et 1 au-delà de 4 Mpx rendus (une télé 4K à DPR 2 en ferait 8). */
const DPR_MAX = 1.5;
const PIXELS_MAX = 4_000_000;
/** Le plateau remplit la fenêtre : la résolution se choisit d’après sa taille (voir DPR_MAX). */
function useResolution(): number {
  const calculer = () => {
    const voulu = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    return window.innerWidth * window.innerHeight * voulu * voulu > PIXELS_MAX ? 1 : Math.max(1, voulu);
  };
  const [dpr, setDpr] = useState(calculer);
  useEffect(() => {
    const maj = () => setDpr(calculer());
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);
  return dpr;
}
/** Taille de base d’un personnage à l’écran (px) pour une case de 100 px. */
const CASE_REF_PX = 100;

/** Mémoire de l’animation, partagée entre la boucle 3D et les personnages à l’écran. */
interface Mon {
  seq: number | null;
  /** Position affichée au sol de chaque personnage. */
  sol: Map<string, THREE.Vector3>;
  /** Début du saut en cours, par personnage (secondes de l’horloge 3D). */
  saut: Map<string, number>;
  /** Décalage vertical courant de chaque personnage (saut). */
  hauteur: Map<string, number>;
  /** Objets déjà placés : le premier passage les pose sans les faire glisser. */
  vus: Set<string>;
  objets: Map<string, THREE.Object3D>;
  figures: Map<string, HTMLElement>;
}

function nouvelleMemoire(): Mon {
  return {
    seq: null,
    sol: new Map(),
    saut: new Map(),
    hauteur: new Map(),
    vus: new Set(),
    objets: new Map(),
    figures: new Map(),
  };
}

/** Coordonnées du plateau : la grille est centrée sur l’origine. */
const monX = (x: number, e: Pick<EtatGrille, 'largeur'>) => x - (e.largeur - 1) / 2;
const monZ = (y: number, e: Pick<EtatGrille, 'hauteur'>) => y - (e.hauteur - 1) / 2;

/**
 * Ce que le décor lit de l’état : le plan et sa taille. Chaque message serveur recrée `etat.decor` (même
 * contenu, autre identité) : `Monde` en garde une version stable, pour que le décor ne soit pas redessiné.
 */
type Plan = Pick<EtatGrille, 'decor' | 'largeur' | 'hauteur'>;

/** Hauteur du sol sur une case : celle d’une plateforme, ou le plateau. */
function hauteurDuSol(e: EtatGrille, x: number, y: number): number {
  return e.decor[y]?.[x] === CASE_PLATEFORME ? HAUTEUR_PLATEFORME : 0;
}

/** Hauteur du centre d’un objet posé, selon sa nature. */
function hauteurPosee(nature: ObjetGrille['nature']): number {
  if (nature === 'caisse') return TAILLE_CAISSE / 2;
  if (nature === 'ballon') return RAYON_BALLON;
  return TAILLE_BOITE / 2;
}

/** Position cible d’un objet : posé sur sa case, ou tenu au-dessus de son porteur. */
function cibleObjet(o: ObjetGrille, e: EtatGrille, mon: Mon): THREE.Vector3 | null {
  if (o.porte) {
    const porteur = mon.sol.get(o.porte);
    if (!porteur) return null;
    const saut = mon.hauteur.get(o.porte) ?? 0;
    return new THREE.Vector3(porteur.x, porteur.y + HAUTEUR_TETE + saut, porteur.z);
  }
  return new THREE.Vector3(monX(o.x, e), hauteurDuSol(e, o.x, o.y) + hauteurPosee(o.nature), monZ(o.y, e));
}

/** Échelle minimale de l’étiquette : 14 px de base x 1,5 = 21 px à l’écran, lisible à distance de télé. */
const NOM_ECHELLE_MIN = 1.5;
/** Demi-largeur réservée à l’étiquette (11 caractères) pour ne pas être rognée par le bord de l’écran. */
const NOM_MARGE_PX = 90;

/** Place un personnage à l’écran : son pied tombe sur sa case, et sa taille suit la perspective. */
function placerFigure(
  el: HTMLElement,
  sol: THREE.Vector3,
  saut: number,
  camera: THREE.Camera,
  largeur: number,
  hauteur: number,
) {
  const pied = new THREE.Vector3(sol.x, sol.y + saut, sol.z).project(camera);
  const cote = new THREE.Vector3(sol.x + 1, sol.y + saut, sol.z).project(camera);
  const sx = ((pied.x + 1) / 2) * largeur;
  const sy = ((1 - pied.y) / 2) * hauteur;
  const cellule = Math.abs(((cote.x + 1) / 2) * largeur - sx);
  const echelle = Math.max(0.15, cellule / CASE_REF_PX);
  el.style.transform = `translate3d(${sx}px, ${sy}px, 0) scale(${echelle})`;
  // L’étiquette garde une taille minimale à l’écran (lisible de loin) et reste dans l’écran.
  const contre = Math.max(echelle, NOM_ECHELLE_MIN) / echelle;
  const dx = Math.min(Math.max(sx, NOM_MARGE_PX), Math.max(NOM_MARGE_PX, largeur - NOM_MARGE_PX)) - sx;
  // Seules les valeurs qui changent sont écrites : un personnage immobile ne touche plus au style.
  const valeurContre = String(contre);
  const valeurDx = `${dx / echelle}px`;
  if (el.style.getPropertyValue('--contre') !== valeurContre) el.style.setProperty('--contre', valeurContre);
  if (el.style.getPropertyValue('--nom-dx') !== valeurDx) el.style.setProperty('--nom-dx', valeurDx);
}

/**
 * Ajuste la caméra pour que tout le plateau tienne dans l’écran (de `ecranL` × `ecranH` px), vu de haut
 * et de biais.
 */
function cadrer(
  camera: THREE.PerspectiveCamera,
  cases: { largeur: number; hauteur: number },
  ecranL: number,
  ecranH: number,
) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const aspect = ecranL / Math.max(1, ecranH);
  // Marge réduite : la zone de jeu occupe tout ce qui est visible.
  const demiL = cases.largeur / 2 + 0.5;
  const demiH = cases.hauteur / 2 + 0.5;
  const distance = Math.max(demiH / tan, demiL / (tan * aspect));
  camera.position.set(0, distance * 0.82, distance * 0.58);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Les matières du plateau : sol peint, murs (buisson, glace ou pierre), caisses en bois. */
interface Surfaces {
  sol: THREE.Texture;
  mur: THREE.Texture;
  caisse: THREE.Texture;
}

/** Dessine le sol case par case, aux couleurs du thème, avec de l’herbe, des fissures de glace ou des dalles. */
function textures(cases: { largeur: number; hauteur: number }, theme: ThemePlateau): Surfaces {
  const [couleurA, couleurB] = theme.dalles;
  const sol = canvasTexture(cases.largeur * 64, cases.hauteur * 64, (ctx, w, h) => {
    const cw = w / cases.largeur;
    const ch = h / cases.hauteur;
    for (let y = 0; y < cases.hauteur; y++) {
      for (let x = 0; x < cases.largeur; x++) {
        // Un court est d’une seule couleur : le damier ne sert qu’aux dalles.
        ctx.fillStyle = theme.motifSol === 'court' || (x + y) % 2 === 0 ? couleurA : couleurB;
        ctx.fillRect(x * cw, y * ch, cw, ch);
        if (theme.motifSol === 'dalles') {
          // Des dalles de pierre : un liseré sombre autour de chaque case.
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x * cw + 1.5, y * ch + 1.5, cw - 3, ch - 3);
          // Des rivets aux quatre coins : des plaques de métal.
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          for (const [fx, fy] of [
            [0.14, 0.14],
            [0.86, 0.14],
            [0.14, 0.86],
            [0.86, 0.86],
          ] as const) {
            ctx.beginPath();
            ctx.arc(x * cw + cw * fx, y * ch + ch * fy, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (theme.motifSol === 'mousse') {
          // Les coutures d’un tapis de réception.
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 2;
          ctx.strokeRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
        } else if (theme.motifSol === 'glace') {
          // De la glace : un reflet blanc en biais sur chaque case.
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(x * cw + cw * 0.15, y * ch + ch * 0.85);
          ctx.lineTo(x * cw + cw * 0.55, y * ch + ch * 0.15);
          ctx.stroke();
        }
      }
    }
    if (theme.motifSol === 'herbe') touffesHerbe(ctx, w, h, couleurA, 11, 0.02);
    if (theme.motifSol === 'court') {
      // Un court en dur : grain fin, lignes doubles et simples, ligne de service et marques de fond de court.
      const r = hasard(29);
      for (let k = 0; k < 900; k++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
      const cw = w / cases.largeur;
      const ch = h / cases.hauteur;
      const m = cw * 0.5;
      const simple = ch * 1.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.94)';
      ctx.lineWidth = 5;
      ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
      ctx.beginPath();
      // Lignes simples, le long des côtés.
      ctx.moveTo(m, simple);
      ctx.lineTo(w - m, simple);
      ctx.moveTo(m, h - simple);
      ctx.lineTo(w - m, h - simple);
      // Lignes de service, à 3,5 cases du filet.
      ctx.moveTo(cw * 3, simple);
      ctx.lineTo(cw * 3, h - simple);
      ctx.moveTo(cw * 10, simple);
      ctx.lineTo(cw * 10, h - simple);
      ctx.moveTo(cw * 3, h / 2);
      ctx.lineTo(cw * 10, h / 2);
      // Le filet, au milieu.
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      // Marques de fond de court.
      ctx.moveTo(m, h / 2);
      ctx.lineTo(m + cw * 0.4, h / 2);
      ctx.moveTo(w - m, h / 2);
      ctx.lineTo(w - m - cw * 0.4, h / 2);
      ctx.stroke();
    }
    if (theme.forme === 'ronde') {
      // Un anneau de combat, peint au sol.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.42, h * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (theme.motifSol === 'glace') {
      // Des fissures blanches qui traversent la banquise.
      const r = hasard(21);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        ctx.beginPath();
        let x = r() * w;
        let y = r() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += (r() - 0.5) * 90;
          y += (r() - 0.5) * 90;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  });
  const mur =
    theme.mur.motif === 'feuillage'
      ? texFeuillage(theme.mur.couleur, 9)
      : theme.mur.motif === 'prise'
        ? texPrises(theme.mur.couleur, 5)
        : theme.mur.motif === 'glace'
          ? texGlace(theme.mur.couleur, 4)
          : texPierre(theme.mur.couleur, theme.mur.joint, 6);
  const caisse = texBois(theme.caisse.couleur, theme.caisse.trait, 2);
  return { sol, mur, caisse };
}

/** Le filet d’un court, au milieu du plateau : une toile et deux poteaux. Il ne bloque pas les personnages. */
function Filet({ etat }: { etat: Plan }) {
  const x = monX(Math.floor(etat.largeur / 2), etat);
  const z0 = monZ(0, etat) - 0.5;
  const z1 = monZ(etat.hauteur - 1, etat) + 0.5;
  const longueur = z1 - z0;
  const milieu = (z0 + z1) / 2;
  const toile = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.85,
        roughness: 0.6,
        depthWrite: false,
      }),
    [],
  );
  const blanc = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 }), []);
  useEffect(
    () => () => {
      toile.dispose();
      blanc.dispose();
    },
    [toile, blanc],
  );
  return (
    <group>
      <mesh geometry={GEO.cube} material={toile} position={[x, 0.3, milieu]} scale={[0.07, 0.5, longueur]} />
      <mesh geometry={GEO.cube} material={blanc} position={[x, 0.5, milieu]} scale={[0.07, 0.05, longueur]} />
      {[z0, z1].map((z) => (
        <mesh key={z} geometry={GEO.cylindre} material={blanc} position={[x, 0.36, z]} scale={[0.05, 0.72, 0.05]} />
      ))}
    </group>
  );
}

/**
 * Le sol d’une forme courbe : le contour (en coordonnées du monde) extrudé, de l’épaisseur du socle.
 * Les UV suivent la grille, pour que le motif du sol tombe juste sur les cases.
 */
function contourEnGeometrie(
  points: Array<[number, number]>,
  largeur: number,
  hauteur: number,
  epaisseur: number,
): THREE.BufferGeometry {
  const forme = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(forme, { depth: epaisseur, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -epaisseur, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / largeur + 0.5, pos.getZ(i) / hauteur + 0.5);
  }
  uv.needsUpdate = true;
  return g;
}

/** Le grillage d’un court : des panneaux de toile tout autour, fixés sur les poteaux. */
function Grillage({ etat }: { etat: Plan }) {
  const toile = useMemo(() => {
    const t = texFiletMaille();
    t.repeat.set(6, 1);
    return new THREE.MeshStandardMaterial({
      map: t,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      roughness: 0.7,
    });
  }, []);
  useEffect(
    () => () => {
      toile.map?.dispose();
      toile.dispose();
    },
    [toile],
  );
  const x0 = monX(0, etat);
  const x1 = monX(etat.largeur - 1, etat);
  const z0 = monZ(0, etat);
  const z1 = monZ(etat.hauteur - 1, etat);
  return (
    <group>
      {[z0, z1].map((z) => (
        <mesh
          key={`z${z}`}
          geometry={GEO.cube}
          material={toile}
          position={[0, 0.42, z]}
          scale={[etat.largeur - 1, 0.8, 0.03]}
        />
      ))}
      {[x0, x1].map((x) => (
        <mesh
          key={`x${x}`}
          geometry={GEO.cube}
          material={toile}
          position={[x, 0.42, 0]}
          scale={[0.03, 0.8, etat.hauteur - 1]}
        />
      ))}
    </group>
  );
}

/** Le mobilier d’un court, hors du jeu : la chaise de l’arbitre et deux bancs de joueurs. */
function Accessoires({ etat }: { etat: Plan }) {
  const blanc = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 }), []);
  const bleu = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f4fa0', roughness: 0.6 }), []);
  const acier = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.4, metalness: 0.5 }), []);
  useEffect(
    () => () => {
      blanc.dispose();
      bleu.dispose();
      acier.dispose();
    },
    [blanc, bleu, acier],
  );
  const zChaise = monZ(0, etat) - 1.8;
  const zBanc = monZ(etat.hauteur - 1, etat) + 1.8;
  return (
    // Le mobilier pose sur la pelouse, au niveau du sol.
    <group position={[0, -0.36, 0]}>
      <mesh geometry={GEO.cube} material={acier} position={[0, 0.9, zChaise]} scale={[0.1, 1.8, 0.1]} />
      <mesh geometry={GEO.cube} material={bleu} position={[0, 2, zChaise]} scale={[0.9, 0.7, 0.8]} castShadow />
      <mesh geometry={GEO.cube} material={blanc} position={[0, 2.42, zChaise]} scale={[1, 0.1, 0.9]} castShadow />
      {[-3.5, 3.5].map((x) => (
        <group key={x} position={[x, 0, zBanc]}>
          <mesh geometry={GEO.cube} material={blanc} position={[0, 0.5, 0]} scale={[1.6, 0.1, 0.5]} castShadow />
          <mesh geometry={GEO.cube} material={acier} position={[-0.6, 0.25, 0]} scale={[0.08, 0.5, 0.4]} />
          <mesh geometry={GEO.cube} material={acier} position={[0.6, 0.25, 0]} scale={[0.08, 0.5, 0.4]} />
        </group>
      ))}
    </group>
  );
}

const Decor = memo(function Decor({
  etat,
  theme,
  tex,
  reduced,
}: {
  etat: Plan;
  theme: ThemePlateau;
  tex: Surfaces;
  reduced: boolean;
}) {
  const { largeur, hauteur } = etat;
  const murs: Array<[number, number]> = [];
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (etat.decor[y]?.[x] === '#') murs.push([x, y]);
    }
  }
  const courbe = theme.forme !== 'carree';
  // Dans une forme courbe, la barrière extérieure reste une règle (les cases hors de la zone bloquent)
  // mais elle ne se dessine pas : seuls les murs à l’intérieur de la zone sont visibles.
  const positionsMurs = useMemo(
    () =>
      murs
        .filter(([x, y]) => !courbe || formeContient(theme.forme, largeur, hauteur, x, y))
        .map(([x, y]): [number, number] => [monX(x, etat), monZ(y, etat)]),
    // Les murs ne bougent pas : on ne refait leur liste que si le plateau change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etat.decor, largeur, hauteur, courbe, theme.forme],
  );
  const socle = socleDe(theme.ambiance);
  const dessus = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.sol, roughness: 0.9 }), [tex]);
  const flancs = useMemo(() => new THREE.MeshStandardMaterial({ color: socle.flanc, roughness: 0.85 }), [socle.flanc]);
  const rebord = useMemo(() => new THREE.MeshStandardMaterial({ color: socle.rebord, roughness: 0.7 }), [socle.rebord]);
  const murMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.mur, roughness: 0.85 }), [tex]);
  const contourSol = useMemo(
    () =>
      courbe
        ? contourEnGeometrie(contourDeLaForme(theme.forme, largeur, hauteur, 72, 1), largeur, hauteur, socle.epaisseur)
        : null,
    [courbe, theme.forme, largeur, hauteur, socle.epaisseur],
  );
  const contourBord = useMemo(
    () =>
      courbe
        ? contourEnGeometrie(
            contourDeLaForme(theme.forme, largeur, hauteur, 72, 1.6),
            largeur,
            hauteur,
            socle.epaisseur,
          )
        : null,
    [courbe, theme.forme, largeur, hauteur, socle.epaisseur],
  );
  useEffect(
    () => () => {
      dessus.dispose();
      flancs.dispose();
      rebord.dispose();
      murMat.dispose();
      contourSol?.dispose();
      contourBord?.dispose();
    },
    [dessus, flancs, rebord, murMat, contourSol, contourBord],
  );
  return (
    <group>
      <Environnement theme={theme} taille={{ largeur, hauteur }} reduced={reduced} />
      {/* Le plateau est un bloc : dessus peint, flancs de la couleur du lieu, bord clair autour. */}
      {courbe && contourSol && contourBord ? (
        <>
          <mesh geometry={contourBord} material={rebord} position={[0, -0.06, 0]} receiveShadow castShadow />
          <mesh geometry={contourSol} material={[dessus, flancs]} receiveShadow castShadow />
        </>
      ) : (
        <>
          <mesh
            geometry={GEO.cube}
            material={rebord}
            position={[0, -socle.epaisseur / 2 - 0.06, 0]}
            scale={[largeur + 1.2, socle.epaisseur, hauteur + 1.2]}
            receiveShadow
            castShadow
          />
          <mesh
            geometry={GEO.cube}
            material={[flancs, flancs, dessus, flancs, flancs, flancs]}
            position={[0, -socle.epaisseur / 2, 0]}
            scale={[largeur, socle.epaisseur, hauteur]}
            receiveShadow
            castShadow
          />
        </>
      )}
      <Murs theme={theme} positions={positionsMurs} materiau={murMat} />
      <Plateformes etat={etat} theme={theme} />
      <DetailsSol etat={etat} theme={theme} />
      {theme.filet && <Filet etat={etat} />}
      {theme.murs === 'grillage' && <Grillage etat={etat} />}
      {theme.murs === 'grillage' && <Accessoires etat={etat} />}
    </group>
  );
});

/** Plateformes : des blocs surélevés, en pierre, avec un dessus de la matière du sol. */
function Plateformes({ etat, theme }: { etat: Plan; theme: ThemePlateau }) {
  const cases = useMemo(() => {
    const liste: Array<[number, number]> = [];
    etat.decor.forEach((ligne, y) =>
      ligne.split('').forEach((c, x) => {
        if (c === CASE_PLATEFORME) liste.push([x, y]);
      }),
    );
    return liste;
  }, [etat.decor]);
  const materiaux = useMemo(() => {
    const herbeux = theme.motifSol === 'herbe' || theme.motifSol === 'mousse';
    const dessusTex = herbeux
      ? texHerbe(theme.dalles[0] ?? theme.sol, 21)
      : texPierre(theme.dalles[0] ?? theme.sol, theme.mur.joint, 21);
    const corpsTex = texPierre(theme.mur.couleur, theme.mur.joint, 22);
    return {
      corps: new THREE.MeshStandardMaterial({ map: corpsTex, roughness: 0.85 }),
      dessus: new THREE.MeshStandardMaterial({ map: dessusTex, roughness: 0.9 }),
      textures: [dessusTex, corpsTex],
    };
  }, [theme]);
  useEffect(
    () => () => {
      materiaux.corps.dispose();
      materiaux.dessus.dispose();
      materiaux.textures.forEach((t) => t.dispose());
    },
    [materiaux],
  );
  return (
    <group>
      {cases.map(([x, y]) => (
        <group key={`${x}-${y}`} position={[monX(x, etat), 0, monZ(y, etat)]}>
          <mesh
            geometry={GEO.bloc}
            material={materiaux.corps}
            position={[0, HAUTEUR_PLATEFORME / 2, 0]}
            scale={[0.96, HAUTEUR_PLATEFORME, 0.96]}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={GEO.bloc}
            material={materiaux.dessus}
            position={[0, HAUTEUR_PLATEFORME + 0.02, 0]}
            scale={[0.98, 0.06, 0.98]}
            receiveShadow
          />
        </group>
      ))}
    </group>
  );
}

/** Un détail posé sur le sol : sans règle, il ne bloque rien et ne change pas le jeu. */
interface Eparpille {
  x: number;
  y: number;
  z: number;
  /** Taille en largeur. */
  s: number;
  /** Taille en hauteur. */
  h: number;
  couleur: string;
}

/** Des milliers de petits objets identiques en un seul appel de dessin : touffes, glaçons, cailloux, craie. */
function Eparpiller({ items, geometrie }: { items: Eparpille[]; geometrie: THREE.BufferGeometry }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const materiau = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), []);
  useEffect(() => () => materiau.dispose(), [materiau]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const matrice = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const echelle = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const couleur = new THREE.Color();
    items.forEach((it, i) => {
      position.set(it.x, it.y, it.z);
      echelle.set(it.s, it.h, it.s);
      matrice.compose(position, quaternion, echelle);
      m.setMatrixAt(i, matrice);
      m.setColorAt(i, couleur.set(it.couleur));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometrie, materiau, items.length]} receiveShadow />;
}

type FormeDetail = 'touffe' | 'glacon' | 'caillou' | 'craie';

/** Ce qui traîne sur le sol, selon le lieu, et la part des cases qui en reçoivent. */
const DETAILS_PAR_LIEU: Record<ThemePlateau['ambiance'], Array<{ forme: FormeDetail; p: number }>> = {
  pelouse: [{ forme: 'touffe', p: 0.3 }],
  ile: [{ forme: 'touffe', p: 0.3 }],
  mer: [{ forme: 'glacon', p: 0.14 }],
  plateforme: [{ forme: 'caillou', p: 0.12 }],
  gymnase: [{ forme: 'craie', p: 0.08 }],
};

const GEOMETRIE_DETAIL: Record<FormeDetail, THREE.BufferGeometry> = {
  touffe: GEO.cone,
  glacon: GEO.rocher,
  caillou: GEO.rocher,
  craie: GEO.sphere,
};

const COULEURS_DETAIL: Record<FormeDetail, string[]> = {
  touffe: ['#4f9a3a', '#5fae45', '#3f8a32', '#6cc063'],
  glacon: ['#f2fdff', '#cdf2ff', '#ffffff'],
  caillou: ['#7d8190', '#6a6f7d', '#8c91a0'],
  craie: ['#ffffff', '#f4f4f4'],
};

/** Une graine stable par lieu : le même plateau montre toujours les mêmes détails. */
function graineDeLieu(id: string): number {
  let graine = 0;
  for (const c of id) graine = (graine * 31 + c.charCodeAt(0)) >>> 0;
  return graine;
}

/** Petits détails répartis sur les cases libres du sol. */
function DetailsSol({ etat, theme }: { etat: Plan; theme: ThemePlateau }) {
  const parForme = useMemo(() => {
    const r = hasard(graineDeLieu(theme.id));
    const groupes = new Map<FormeDetail, Eparpille[]>();
    for (let y = 0; y < etat.hauteur; y++) {
      for (let x = 0; x < etat.largeur; x++) {
        if (etat.decor[y]?.[x] !== '.') continue;
        for (const { forme, p } of DETAILS_PAR_LIEU[theme.ambiance]) {
          if (r() >= p) continue;
          const s =
            forme === 'touffe'
              ? 0.12 + r() * 0.12
              : forme === 'craie'
                ? 0.045
                : forme === 'glacon'
                  ? 0.1 + r() * 0.12
                  : 0.1 + r() * 0.1;
          const couleurs = COULEURS_DETAIL[forme];
          const liste = groupes.get(forme) ?? [];
          // Une touffe est plus haute que large ; elle repose sur le sol. Un caillou est à demi enfoui, la craie est au ras du sol.
          const h = forme === 'touffe' ? s * 1.9 : s;
          liste.push({
            x: monX(x, etat) + (r() - 0.5) * 0.7,
            y: forme === 'touffe' ? h / 2 : forme === 'craie' ? 0.02 : s * 0.3,
            z: monZ(y, etat) + (r() - 0.5) * 0.7,
            s,
            h,
            couleur: couleurs[Math.floor(r() * couleurs.length)] ?? '#ffffff',
          });
          groupes.set(forme, liste);
        }
      }
    }
    return groupes;
    // Les détails ne dépendent que de la taille et du décor, déjà listés ; `etat` ne sert qu’à `monX`/`monZ`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat.decor, etat.largeur, etat.hauteur, theme.id, theme.ambiance]);
  return (
    <group>
      {[...parForme].map(([forme, items]) => (
        <Eparpiller key={`${forme}-${items.length}`} items={items} geometrie={GEOMETRIE_DETAIL[forme]} />
      ))}
    </group>
  );
}

/** Les matières des objets : une seule fois pour tout le plateau. */
interface Materiaux {
  caisse: THREE.Material;
  ballon: THREE.Material;
  boite: THREE.Material;
  ruban: THREE.Material;
  reflet: THREE.Material;
}

/** Un objet 3D : caisse, ballon ou cadeau. Sa place est tenue à jour par la boucle d’animation. */
function ObjetMesh({ objet, mon, mats }: { objet: ObjetGrille; mon: Mon; mats: Materiaux }) {
  const ref = (m: THREE.Object3D | null) => {
    if (m) mon.objets.set(objet.id, m);
    else mon.objets.delete(objet.id);
  };
  if (objet.nature === 'ballon') {
    return (
      <group ref={ref}>
        <Forme geometrie={GEO.sphere} materiau={mats.ballon} contour={0.05} scale={RAYON_BALLON} />
        {/* Un reflet blanc, pour un ballon brillant. */}
        <mesh
          geometry={GEO.sphere}
          material={mats.reflet}
          position={[-RAYON_BALLON * 0.35, RAYON_BALLON * 0.45, RAYON_BALLON * 0.7]}
          scale={RAYON_BALLON * 0.22}
        />
      </group>
    );
  }
  if (objet.nature === 'boite') {
    // Un cadeau : une boîte, un ruban en croix et un nœud dessus.
    return (
      <group ref={ref}>
        <Forme geometrie={GEO.cube} materiau={mats.boite} contour={0.045} scale={TAILLE_BOITE} />
        <mesh
          geometry={GEO.cube}
          material={mats.ruban}
          scale={[TAILLE_BOITE * 1.03, TAILLE_BOITE * 1.03, TAILLE_BOITE * 0.2]}
        />
        <mesh
          geometry={GEO.cube}
          material={mats.ruban}
          scale={[TAILLE_BOITE * 0.2, TAILLE_BOITE * 1.03, TAILLE_BOITE * 1.03]}
        />
        <mesh
          geometry={GEO.sphere}
          material={mats.ruban}
          position={[0, TAILLE_BOITE / 2 + 0.08, 0]}
          scale={0.11}
          castShadow
        />
        <mesh
          geometry={GEO.sphere}
          material={mats.ruban}
          position={[-0.09, TAILLE_BOITE / 2 + 0.12, 0]}
          scale={[0.09, 0.05, 0.05]}
        />
        <mesh
          geometry={GEO.sphere}
          material={mats.ruban}
          position={[0.09, TAILLE_BOITE / 2 + 0.12, 0]}
          scale={[0.09, 0.05, 0.05]}
        />
      </group>
    );
  }
  return (
    <group ref={ref}>
      <Forme geometrie={GEO.cube} materiau={mats.caisse} contour={0.05} scale={TAILLE_CAISSE} />
    </group>
  );
}

/**
 * Le monde : caméra, lumière, décor, objets, et la boucle qui fait glisser chaque élément vers sa case
 * (et place les personnages 2D à l’écran).
 */
function Monde({
  etat,
  mon,
  reduced,
  theme,
  tex,
}: {
  etat: EtatGrille;
  mon: Mon;
  reduced: boolean;
  theme: ThemePlateau;
  tex: Surfaces;
}) {
  const { camera, size, gl } = useThree();

  // Les ombres sont figées (voir SHADOWS) : on ne les redessine que quand un objet qui en projette bouge,
  // ou que le décor change. `ombresAJour` compte les images où il faut encore les recalculer.
  const ombresAJour = useRef(3);
  const etatRef = useRef(etat);
  etatRef.current = etat;

  const { largeur, hauteur } = etat;
  // Le plan garde la même identité tant que son contenu ne change pas : le décor reste en l’état.
  const cle = etat.decor.join('|');
  const plan = useMemo<Plan>(
    () => ({ decor: etatRef.current.decor, largeur, hauteur }),
    // La clé résume le contenu du plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cle, largeur, hauteur],
  );
  const objetsCle = etat.objets.map((o) => o.id).join('|');
  useEffect(() => {
    ombresAJour.current = 3;
  }, [plan, theme, tex, objetsCle]);
  useEffect(() => {
    cadrer(camera as THREE.PerspectiveCamera, { largeur, hauteur }, size.width, size.height);
  }, [camera, largeur, hauteur, size.width, size.height]);

  const mats = useMemo<Materiaux>(
    () => ({
      caisse: new THREE.MeshStandardMaterial({ map: tex.caisse, roughness: 0.75 }),
      ballon: new THREE.MeshStandardMaterial({ color: theme.ballon, roughness: 0.3, metalness: 0.05 }),
      boite: new THREE.MeshStandardMaterial({ color: theme.boite, roughness: 0.55 }),
      ruban: new THREE.MeshStandardMaterial({ color: theme.ballon, roughness: 0.4 }),
      reflet: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    }),
    [tex, theme],
  );
  useEffect(
    () => () => {
      mats.caisse.dispose();
      mats.ballon.dispose();
      mats.boite.dispose();
      mats.ruban.dispose();
      mats.reflet.dispose();
    },
    [mats],
  );

  useFrame((state, dt) => {
    const e = etatRef.current;
    const t = state.clock.elapsedTime;
    const k = reduced ? 1 : 1 - Math.exp(-dt * VITESSE);

    // Un nouveau geste : seul un saut déclenche l’envol. Le premier état reçu ne rejoue rien.
    if (mon.seq === null) mon.seq = e.seq;
    if (e.seq !== mon.seq) {
      mon.seq = e.seq;
      if (e.dernier?.geste === 'saut') mon.saut.set(e.dernier.joueur, t);
    }

    for (const id of [...mon.sol.keys()]) {
      if (!e.personnages[id]) {
        mon.sol.delete(id);
        mon.saut.delete(id);
        mon.hauteur.delete(id);
      }
    }
    for (const p of Object.values(e.personnages)) {
      const cible = new THREE.Vector3(monX(p.x, e), hauteurDuSol(e, p.x, p.y), monZ(p.y, e));
      let sol = mon.sol.get(p.id);
      if (!sol) {
        sol = cible.clone();
        mon.sol.set(p.id, sol);
      }
      sol.lerp(cible, k);
      const debut = mon.saut.get(p.id);
      const ecoule = debut === undefined ? Infinity : t - debut;
      const saut = ecoule < DUREE_SAUT && !reduced ? Math.sin((Math.PI * ecoule) / DUREE_SAUT) * HAUTEUR_SAUT : 0;
      mon.hauteur.set(p.id, saut);
      const el = mon.figures.get(p.id);
      if (el) placerFigure(el, sol, saut, camera, size.width, size.height);
    }

    for (const o of e.objets) {
      const m = mon.objets.get(o.id);
      const cible = cibleObjet(o, e, mon);
      if (!m || !cible) continue;
      if (!mon.vus.has(o.id)) {
        m.position.copy(cible);
        mon.vus.add(o.id);
        ombresAJour.current = 3;
      } else {
        // Un objet qui avance de plus d’un millimètre déplace son ombre : on la redessine.
        if (m.position.distanceToSquared(cible) > 1e-6) ombresAJour.current = 3;
        m.position.lerp(cible, k);
      }
    }
    if (ombresAJour.current > 0) {
      ombresAJour.current--;
      gl.shadowMap.needsUpdate = true;
    }
  });

  const { lumiere } = theme;
  const cie = cieDe(theme.ambiance);
  return (
    <>
      <fog attach="fog" args={[cie.bas, 30, 95]} />
      <ambientLight intensity={lumiere.ambiante * 0.55} />
      <hemisphereLight args={[cie.haut, theme.sol, 0.7]} />
      {/* Le soleil, avec des ombres nettes ; un contre-jour bleuté adoucit les ombres. */}
      <directionalLight
        position={[7, 13, 6]}
        intensity={lumiere.soleil * 1.1}
        color={lumiere.couleurSoleil}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-8, 6, -6]} intensity={lumiere.soleil * 0.25} color="#b8d8ff" />
      <Decor etat={plan} theme={theme} tex={tex} reduced={reduced} />
      {etat.objets.map((o) => (
        <ObjetMesh key={o.id} objet={o} mon={mon} mats={mats} />
      ))}
    </>
  );
}

/** Un personnage 2D posé sur le plateau : son profil, sa pose, son nom. Sa place est donnée par `Monde`. */
function Figure({ perso, apparence, mon }: { perso: PersonnageGrille; apparence: GrilleApparence; mon: Mon }) {
  const sens = perso.dir === 'left' ? -1 : 1;
  const classes = ['grille3d-figure'];
  if (apparence.mine) classes.push('is-own');
  if (apparence.away) classes.push('is-away');
  return (
    <div
      className={classes.join(' ')}
      role="img"
      data-id={perso.id}
      data-x={perso.x}
      data-y={perso.y}
      data-dir={perso.dir}
      data-attitude={perso.attitude}
      aria-label={`${apparence.name}${apparence.mine ? ' (vous)' : ''}`}
      ref={(el) => {
        if (el) mon.figures.set(perso.id, el);
        else mon.figures.delete(perso.id);
      }}
    >
      <span className="grille3d-ombre" aria-hidden="true" />
      <div className="grille3d-corps">
        <div className="grille3d-face" style={{ transform: `scaleX(${sens})` }}>
          <div className="grille-bob">
            {apparence.character ? (
              <Character spec={apparence.character} mood={ATTITUDE_POSE[perso.attitude]} framing="full" />
            ) : (
              (apparence.avatar ?? <span className="grille-initiale">{apparence.name.slice(0, 1)}</span>)
            )}
          </div>
        </div>
        <span className="grille-nom">
          <span>{apparence.name}</span>
          {apparence.tags?.map((t) => (
            <span key={t} className="grille-tag">
              {t}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export interface GrilleBoard3DProps {
  etat: EtatGrille;
  /** Apparence de chaque personnage, par identifiant. */
  apparences: Record<string, GrilleApparence>;
  /** Nom du plateau pour les lecteurs d’écran. */
  label: string;
  /** Décor du plateau : pelouse de fête, plateforme de combat, banquise en mer. */
  theme?: ThemeId;
}

/** Plateau en grille en 3D, plein écran. Les personnages 2D sont superposés, au-dessus du canevas. */
export default function GrilleBoard3D({ etat, apparences, label, theme }: GrilleBoard3DProps) {
  const reduced = usePrefersReducedMotion();
  const resolution = useResolution();
  const [mon] = useState(nouvelleMemoire);
  const decor = themeDePlateau(theme);
  const cie = cieDe(decor.ambiance);
  const tex = useMemo(
    () => textures({ largeur: etat.largeur, hauteur: etat.hauteur }, decor),
    [etat.largeur, etat.hauteur, decor],
  );
  useEffect(
    () => () => {
      tex.sol.dispose();
      tex.mur.dispose();
      tex.caisse.dispose();
    },
    [tex],
  );
  const personnages = Object.values(etat.personnages);
  return (
    <div
      className="grille3d"
      role="group"
      aria-label={label}
      style={{ background: `linear-gradient(180deg, ${cie.haut} 0%, ${cie.bas} 90%)` }}
    >
      <Canvas
        camera={{ position: [0, 10, 8], fov: 36 }}
        shadows={SHADOWS}
        dpr={resolution}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          // Couleurs franches et douces, sans écraser les clairs ni délaver les ombres.
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1;
        }}
      >
        <Monde etat={etat} mon={mon} reduced={reduced} theme={decor} tex={tex} />
      </Canvas>
      <div className="grille3d-figures">
        {personnages.map((perso) => (
          <Figure key={perso.id} perso={perso} apparence={apparences[perso.id] ?? { name: perso.id }} mon={mon} />
        ))}
      </div>
    </div>
  );
}
