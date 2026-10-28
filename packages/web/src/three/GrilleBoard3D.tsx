import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ATTITUDE_POSE, type EtatGrille, type ObjetGrille, type PersonnageGrille } from '@partyhub/shared';
import { Character, usePrefersReducedMotion, type GrilleApparence } from '@partyhub/games/client';
import { canvasTexture } from './canvas-texture';

/**
 * Plateau en grille en 3D, plein écran sur la TV. Le décor (sol, murs, caisses, ballons, boîtes) est en
 * trois dimensions ; les personnages restent les dessins 2D de leur profil, posés sur le plateau. Chaque
 * image, leur place à l’écran est calculée à partir de la caméra : ils suivent le sol, sautent et portent.
 *
 * Réutilisable par tout jeu qui a un plateau en grille (voir `shared/grille.ts`).
 */

const HAUT_MUR = 0.95;
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

const SOL = '#6cc063';
const SOL_2 = '#62b45a';

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

/** Sol en damier, murs en briques, caisses en bois : des textures dessinées, sans image externe. */
function textures(cases: { largeur: number; hauteur: number }) {
  const sol = canvasTexture(cases.largeur * 64, cases.hauteur * 64, (ctx, w, h) => {
    const cw = w / cases.largeur;
    const ch = h / cases.hauteur;
    for (let y = 0; y < cases.hauteur; y++) {
      for (let x = 0; x < cases.largeur; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? SOL : SOL_2;
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  });
  const brique = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8a5a3b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(40,20,10,0.55)';
    ctx.lineWidth = 4;
    for (let r = 0; r <= 4; r++) {
      const y = (r * h) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      const decal = r % 2 === 0 ? 0 : w / 4;
      for (let c = 0; c <= 2; c++) {
        const x = decal + (c * w) / 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h / 4);
        ctx.stroke();
      }
    }
  });
  const caisse = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9783f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(w - 8, h - 8);
    ctx.moveTo(w - 8, 8);
    ctx.lineTo(8, h - 8);
    ctx.stroke();
  });
  return { sol, brique, caisse };
}

function Decor({ etat }: { etat: EtatGrille }) {
  // Les textures ne dépendent que de la taille du plateau.
  const { largeur, hauteur } = etat;
  const tex = useMemo(() => textures({ largeur, hauteur }), [largeur, hauteur]);
  useEffect(
    () => () => {
      tex.sol.dispose();
      tex.brique.dispose();
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
  return (
    <group>
      {/* Socle sous la grille, plus large que le sol : on voit le bord du plateau. */}
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <boxGeometry args={[etat.largeur + 1.2, 0.2, etat.hauteur + 1.2]} />
        <meshStandardMaterial color="#3b2a1c" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[etat.largeur, etat.hauteur]} />
        <meshStandardMaterial map={tex.sol} roughness={0.95} />
      </mesh>
      {murs.map(([x, y]) => (
        <mesh key={`m${x}-${y}`} position={[monX(x, etat), HAUT_MUR / 2, monZ(y, etat)]} castShadow receiveShadow>
          <boxGeometry args={[1, HAUT_MUR, 1]} />
          <meshStandardMaterial map={tex.brique} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Un objet 3D : caisse, ballon ou boîte. Sa place est tenue à jour par la boucle d’animation. */
function ObjetMesh({ objet, mon }: { objet: ObjetGrille; mon: Mon }) {
  const ref = (m: THREE.Object3D | null) => {
    if (m) mon.objets.set(objet.id, m);
    else mon.objets.delete(objet.id);
  };
  if (objet.nature === 'ballon') {
    return (
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[RAYON_BALLON, 28, 20]} />
        <meshStandardMaterial color="#ef4444" roughness={0.35} metalness={0.05} />
      </mesh>
    );
  }
  if (objet.nature === 'boite') {
    return (
      <mesh ref={ref} castShadow>
        <boxGeometry args={[TAILLE_BOITE, TAILLE_BOITE, TAILLE_BOITE]} />
        <meshStandardMaterial color="#e0b57a" roughness={0.85} />
      </mesh>
    );
  }
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[TAILLE_CAISSE, TAILLE_CAISSE, TAILLE_CAISSE]} />
      <meshStandardMaterial color="#b9783f" roughness={0.8} />
    </mesh>
  );
}

/**
 * Le monde : caméra, lumière, décor, objets, et la boucle qui fait glisser chaque élément vers sa case
 * (et place les personnages 2D à l’écran).
 */
function Monde({ etat, mon, reduced }: { etat: EtatGrille; mon: Mon; reduced: boolean }) {
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

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 9, 6]} intensity={1.15} castShadow />
      <hemisphereLight args={['#e6f7ff', '#3c6b2c', 0.45]} />
      <Decor etat={etat} />
      {etat.objets.map((o) => (
        <ObjetMesh key={o.id} objet={o} mon={mon} />
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
}

/** Plateau en grille en 3D, plein écran. Les personnages 2D sont superposés, au-dessus du canevas. */
export default function GrilleBoard3D({ etat, apparences, label }: GrilleBoard3DProps) {
  const reduced = usePrefersReducedMotion();
  const [mon] = useState(nouvelleMemoire);
  const personnages = Object.values(etat.personnages);
  return (
    <div className="grille3d" role="group" aria-label={label}>
      <Canvas
        camera={{ position: [0, 10, 8], fov: 36 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Monde etat={etat} mon={mon} reduced={reduced} />
      </Canvas>
      <div className="grille3d-figures">
        {personnages.map((perso) => (
          <Figure key={perso.id} perso={perso} apparence={apparences[perso.id] ?? { name: perso.id }} mon={mon} />
        ))}
      </div>
    </div>
  );
}
