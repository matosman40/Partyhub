import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ATTITUDE_POSE,
  themeDePlateau,
  type EtatGrille,
  type ObjetGrille,
  type PersonnageGrille,
  type ThemeId,
  type ThemePlateau,
} from '@partyhub/shared';
import { Character, usePrefersReducedMotion, type GrilleApparence } from '@partyhub/games/client';
import { canvasTexture } from './canvas-texture';
import { Environnement, MurDecor, hasard, socleDe } from './Ambiance3D';

/**
 * Plateau en grille en 3D, plein écran sur la TV. Le décor (sol, murs, caisses, ballons, boîtes) est en
 * trois dimensions, aux couleurs du thème choisi par le jeu ; les personnages restent les dessins 2D de
 * leur profil, posés sur le plateau. Leur place à l’écran est calculée à partir de la caméra : ils suivent
 * le sol, sautent et portent.
 *
 * Réutilisable par tout jeu qui a un plateau en grille (voir `shared/grille.ts`).
 */

const TAILLE_CAISSE = 0.78;
const RAYON_BALLON = 0.3;
const TAILLE_BOITE = 0.55;
/** Hauteur où la boîte portée est tenue, au-dessus du sol (en tête du porteur). */
const HAUTEUR_TETE = 1.3;
/** Saut : durée et hauteur maximale, en unités du plateau. */
const DUREE_SAUT = 0.5;
const HAUTEUR_SAUT = 0.7;
/** Vitesse de glissement vers la case d’arrivée (par seconde, approx.). */
const VITESSE = 12;
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
const monX = (x: number, e: EtatGrille) => x - (e.largeur - 1) / 2;
const monZ = (y: number, e: EtatGrille) => y - (e.hauteur - 1) / 2;

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
    return new THREE.Vector3(porteur.x, HAUTEUR_TETE + saut, porteur.z);
  }
  return new THREE.Vector3(monX(o.x, e), hauteurPosee(o.nature), monZ(o.y, e));
}

/** Place un personnage à l’écran : son pied tombe sur sa case, et sa taille suit la perspective. */
function placerFigure(
  el: HTMLElement,
  sol: THREE.Vector3,
  saut: number,
  camera: THREE.Camera,
  largeur: number,
  hauteur: number,
) {
  const pied = new THREE.Vector3(sol.x, saut, sol.z).project(camera);
  const cote = new THREE.Vector3(sol.x + 1, saut, sol.z).project(camera);
  const sx = ((pied.x + 1) / 2) * largeur;
  const sy = ((1 - pied.y) / 2) * hauteur;
  const cellule = Math.abs(((cote.x + 1) / 2) * largeur - sx);
  const echelle = Math.max(0.15, cellule / CASE_REF_PX);
  el.style.transform = `translate3d(${sx}px, ${sy}px, 0) scale(${echelle})`;
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
  const demiL = cases.largeur / 2 + 0.9;
  const demiH = cases.hauteur / 2 + 0.9;
  const distance = Math.max(demiH / tan, demiL / (tan * aspect));
  camera.position.set(0, distance * 0.82, distance * 0.58);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Textures dessinées aux couleurs du thème : sol, murs, caisses. Aucune image externe à charger. */
function textures(cases: { largeur: number; hauteur: number }, theme: ThemePlateau) {
  const [couleurA, couleurB] = theme.dalles;
  const sol = canvasTexture(cases.largeur * 64, cases.hauteur * 64, (ctx, w, h) => {
    const cw = w / cases.largeur;
    const ch = h / cases.hauteur;
    for (let y = 0; y < cases.hauteur; y++) {
      for (let x = 0; x < cases.largeur; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? couleurA : couleurB;
        ctx.fillRect(x * cw, y * ch, cw, ch);
        if (theme.motifSol === 'dalles') {
          // Des dalles de pierre : un liseré sombre autour de chaque case.
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x * cw + 1.5, y * ch + 1.5, cw - 3, ch - 3);
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
    if (theme.motifSol === 'herbe') {
      // Une pelouse : des touffes d’herbe claires et sombres, posées au hasard (graine fixe).
      const r = hasard(11);
      for (let i = 0; i < cases.largeur * cases.hauteur * 14; i++) {
        const px = r() * w;
        const py = r() * h;
        ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,40,0,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (r() - 0.5) * 6, py - 4 - r() * 5);
        ctx.stroke();
      }
    }
  });
  const mur = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = theme.mur.couleur;
    ctx.fillRect(0, 0, w, h);
    if (theme.mur.motif === 'feuillage') {
      // Un buisson : des feuilles claires et sombres, éparpillées.
      const r = hasard(5);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 5 + r() * 9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme.mur.motif === 'glace') {
      // De la glace : deux reflets blancs.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.9);
      ctx.lineTo(w * 0.5, h * 0.1);
      ctx.moveTo(w * 0.6, h);
      ctx.lineTo(w * 0.95, h * 0.4);
      ctx.stroke();
    } else {
      // Pierre de taille : des blocs décalés d’une rangée à l’autre.
      ctx.strokeStyle = theme.mur.joint;
      ctx.lineWidth = 4;
      for (let r = 0; r < 4; r++) {
        const y = (r * h) / 4;
        const decal = r % 2 === 0 ? 0 : w / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        for (let c = -1; c <= 2; c++) {
          const x = decal + (c * w) / 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + h / 4);
          ctx.stroke();
        }
      }
    }
  });
  const caisse = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = theme.caisse.couleur;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = theme.caisse.trait;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(w - 8, h - 8);
    ctx.moveTo(w - 8, 8);
    ctx.lineTo(8, h - 8);
    ctx.stroke();
  });
  return { sol, mur, caisse };
}

function Decor({ etat, theme, reduced }: { etat: EtatGrille; theme: ThemePlateau; reduced: boolean }) {
  // Les textures ne dépendent que de la taille du plateau et du thème.
  const { largeur, hauteur } = etat;
  const tex = useMemo(() => textures({ largeur, hauteur }, theme), [largeur, hauteur, theme]);
  useEffect(
    () => () => {
      tex.sol.dispose();
      tex.mur.dispose();
      tex.caisse.dispose();
    },
    [tex],
  );
  const murs: Array<[number, number]> = [];
  for (let y = 0; y < etat.hauteur; y++) {
    for (let x = 0; x < etat.largeur; x++) {
      if (etat.decor[y]?.[x] === '#') murs.push([x, y]);
    }
  }
  // Le plateau est un bloc : dessus = sol peint, flancs de la couleur du lieu, bord clair autour.
  const socle = socleDe(theme.ambiance);
  const flancs = useMemo(() => new THREE.MeshToonMaterial({ color: socle.flanc }), [socle.flanc]);
  const dessus = useMemo(() => new THREE.MeshToonMaterial({ map: tex.sol }), [tex]);
  const rebord = useMemo(() => new THREE.MeshToonMaterial({ color: socle.rebord }), [socle.rebord]);
  useEffect(
    () => () => {
      flancs.dispose();
      dessus.dispose();
      rebord.dispose();
    },
    [flancs, dessus, rebord],
  );
  return (
    <group>
      <Environnement theme={theme} taille={{ largeur, hauteur }} reduced={reduced} />
      <mesh position={[0, -socle.epaisseur / 2 - 0.06, 0]} receiveShadow castShadow material={rebord}>
        <boxGeometry args={[largeur + 1.2, socle.epaisseur, hauteur + 1.2]} />
      </mesh>
      <mesh
        position={[0, -socle.epaisseur / 2, 0]}
        receiveShadow
        castShadow
        material={[flancs, flancs, dessus, flancs, flancs, flancs]}
      >
        <boxGeometry args={[largeur, socle.epaisseur, hauteur]} />
      </mesh>
      {murs.map(([x, y]) => (
        <MurDecor key={`m${x}-${y}`} theme={theme} x={monX(x, etat)} z={monZ(y, etat)} texture={tex.mur} />
      ))}
    </group>
  );
}

/** Un objet 3D : caisse, ballon ou cadeau. Sa place est tenue à jour par la boucle d’animation. */
function ObjetMesh({ objet, mon, theme }: { objet: ObjetGrille; mon: Mon; theme: ThemePlateau }) {
  const ref = (m: THREE.Object3D | null) => {
    if (m) mon.objets.set(objet.id, m);
    else mon.objets.delete(objet.id);
  };
  if (objet.nature === 'ballon') {
    return (
      <group ref={ref}>
        <mesh castShadow>
          <sphereGeometry args={[RAYON_BALLON, 28, 20]} />
          <meshToonMaterial color={theme.ballon} />
        </mesh>
        {/* Un reflet blanc, pour un ballon brillant. */}
        <mesh position={[-RAYON_BALLON * 0.35, RAYON_BALLON * 0.45, RAYON_BALLON * 0.7]}>
          <sphereGeometry args={[RAYON_BALLON * 0.22, 10, 8]} />
          <meshToonMaterial color="#ffffff" />
        </mesh>
      </group>
    );
  }
  if (objet.nature === 'boite') {
    // Un cadeau : une boîte, un ruban en croix et un nœud dessus.
    const ruban = theme.ballon;
    return (
      <group ref={ref}>
        <mesh castShadow>
          <boxGeometry args={[TAILLE_BOITE, TAILLE_BOITE, TAILLE_BOITE]} />
          <meshToonMaterial color={theme.boite} />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[TAILLE_BOITE * 1.02, TAILLE_BOITE * 1.02, TAILLE_BOITE * 0.18]} />
          <meshToonMaterial color={ruban} />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[TAILLE_BOITE * 0.18, TAILLE_BOITE * 1.02, TAILLE_BOITE * 1.02]} />
          <meshToonMaterial color={ruban} />
        </mesh>
        <mesh position={[0, TAILLE_BOITE / 2 + 0.07, 0]} castShadow>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshToonMaterial color={ruban} />
        </mesh>
      </group>
    );
  }
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[TAILLE_CAISSE, TAILLE_CAISSE, TAILLE_CAISSE]} />
      <meshToonMaterial color={theme.caisse.couleur} />
    </mesh>
  );
}

/**
 * Le monde : caméra, lumière, décor, objets, et la boucle qui fait glisser chaque élément vers sa case
 * (et place les personnages 2D à l’écran).
 */
function Monde({ etat, mon, reduced, theme }: { etat: EtatGrille; mon: Mon; reduced: boolean; theme: ThemePlateau }) {
  const { camera, size } = useThree();
  const etatRef = useRef(etat);
  etatRef.current = etat;

  const { largeur, hauteur } = etat;
  useEffect(() => {
    cadrer(camera as THREE.PerspectiveCamera, { largeur, hauteur }, size.width, size.height);
  }, [camera, largeur, hauteur, size.width, size.height]);

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
      const cible = new THREE.Vector3(monX(p.x, e), 0, monZ(p.y, e));
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
      } else {
        m.position.lerp(cible, k);
      }
    }
  });

  const { lumiere } = theme;
  return (
    <>
      <ambientLight intensity={lumiere.ambiante} />
      <directionalLight position={[4, 9, 6]} intensity={lumiere.soleil} color={lumiere.couleurSoleil} castShadow />
      <hemisphereLight args={[theme.ciel, theme.sol, 0.45]} />
      <Decor etat={etat} theme={theme} reduced={reduced} />
      {etat.objets.map((o) => (
        <ObjetMesh key={o.id} objet={o} mon={mon} theme={theme} />
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
  /** Décor du plateau : fête foraine, arène de combat, banquise… */
  theme?: ThemeId;
}

/** Plateau en grille en 3D, plein écran. Les personnages 2D sont superposés, au-dessus du canevas. */
export default function GrilleBoard3D({ etat, apparences, label, theme }: GrilleBoard3DProps) {
  const reduced = usePrefersReducedMotion();
  const [mon] = useState(nouvelleMemoire);
  const decor = themeDePlateau(theme);
  const personnages = Object.values(etat.personnages);
  return (
    <div
      className="grille3d"
      role="group"
      aria-label={label}
      style={{ background: `linear-gradient(180deg, ${decor.ciel} 0%, ${decor.fond} 88%)` }}
    >
      <Canvas
        camera={{ position: [0, 10, 8], fov: 36 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Monde etat={etat} mon={mon} reduced={reduced} theme={decor} />
      </Canvas>
      <div className="grille3d-figures">
        {personnages.map((perso) => (
          <Figure key={perso.id} perso={perso} apparence={apparences[perso.id] ?? { name: perso.id }} mon={mon} />
        ))}
      </div>
    </div>
  );
}
