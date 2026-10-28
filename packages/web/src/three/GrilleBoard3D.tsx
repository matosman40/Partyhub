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
import { Environnement, Murs, cieDe, hasard, socleDe } from './Ambiance3D';
import { Forme, GEO } from './Forme';
import { texBois, texFeuillage, texGlace, texPierre, touffesHerbe } from './materiaux';

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
        ctx.fillStyle = (x + y) % 2 === 0 ? couleurA : couleurB;
        ctx.fillRect(x * cw, y * ch, cw, ch);
        if (theme.motifSol === 'dalles') {
          // Des dalles de pierre : un liseré sombre autour de chaque case.
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x * cw + 1.5, y * ch + 1.5, cw - 3, ch - 3);
          // Des rivets aux quatre coins : des plaques de métal.
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          for (const [fx, fy] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]] as const) {
            ctx.beginPath();
            ctx.arc(x * cw + cw * fx, y * ch + ch * fy, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
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
      : theme.mur.motif === 'glace'
        ? texGlace(theme.mur.couleur, 4)
        : texPierre(theme.mur.couleur, theme.mur.joint, 6);
  const caisse = texBois(theme.caisse.couleur, theme.caisse.trait, 2);
  return { sol, mur, caisse };
}

function Decor({
  etat,
  theme,
  tex,
  reduced,
}: {
  etat: EtatGrille;
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
  const positionsMurs = useMemo(
    () => murs.map(([x, y]): [number, number] => [monX(x, etat), monZ(y, etat)]),
    // Les murs ne bougent pas : on ne refait leur liste que si le plateau change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etat.decor, largeur, hauteur],
  );
  const socle = socleDe(theme.ambiance);
  const dessus = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.sol, roughness: 0.9 }), [tex]);
  const flancs = useMemo(() => new THREE.MeshStandardMaterial({ color: socle.flanc, roughness: 0.85 }), [socle.flanc]);
  const rebord = useMemo(() => new THREE.MeshStandardMaterial({ color: socle.rebord, roughness: 0.7 }), [socle.rebord]);
  const murMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.mur, roughness: 0.85 }), [tex]);
  useEffect(
    () => () => {
      dessus.dispose();
      flancs.dispose();
      rebord.dispose();
      murMat.dispose();
    },
    [dessus, flancs, rebord, murMat],
  );
  return (
    <group>
      <Environnement theme={theme} taille={{ largeur, hauteur }} reduced={reduced} />
      {/* Le plateau est un bloc : dessus peint, flancs de la couleur du lieu, bord clair autour. */}
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
      <Murs theme={theme} positions={positionsMurs} materiau={murMat} />
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
  const { camera, size } = useThree();
  const etatRef = useRef(etat);
  etatRef.current = etat;

  const { largeur, hauteur } = etat;
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
      <Decor etat={etat} theme={theme} tex={tex} reduced={reduced} />
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
        shadows
        dpr={[1, 2]}
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
