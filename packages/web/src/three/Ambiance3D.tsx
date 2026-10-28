import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemePlateau } from '@partyhub/shared';
import { Forme, GEO } from './Forme';
import { hasard, texFeuillage, texGlace, texHerbe } from './materiaux';
import { canvasTexture } from './canvas-texture';

export { hasard } from './materiaux';

/**
 * Le lieu autour du plateau. Une pelouse avec collines, arbres, fleurs et champignons ; une mer avec une
 * banquise, des îles, des igloos, des pingouins et une eau qui ondule ; une plateforme de pierre au-dessus
 * du vide, avec des torches. Le ciel est un dégradé, la brume fond le lointain dans l’horizon.
 */

/** Hauteur des murs, en unités du plateau. */
export const HAUT_MUR = 0.95;

/** Hauteur du sol de la pelouse, sous le plateau. */
const SOL_PELOUSE = -0.36;
/** Hauteur de la surface de la mer, sous le plateau. */
const SURFACE_MER = -0.62;

/** Le bloc sous le plateau : son épaisseur, la couleur de ses flancs et celle de son rebord. */
export function socleDe(ambiance: ThemePlateau['ambiance']) {
  if (ambiance === 'mer') return { epaisseur: 0.5, flanc: '#2f77a8', rebord: '#eaf9ff' };
  if (ambiance === 'plateforme') return { epaisseur: 1.5, flanc: '#2a3442', rebord: '#f0a04b' };
  if (ambiance === 'gymnase') return { epaisseur: 0.6, flanc: '#1e2a3d', rebord: '#2b7de0' };
  if (ambiance === 'ile') return { epaisseur: 0.32, flanc: '#6b4a2b', rebord: '#e9d28a' };
  return { epaisseur: 0.32, flanc: '#7a4f2e', rebord: '#5fae45' };
}

/** Les couleurs du ciel (haut) et de l’horizon (bas) : l’horizon sert aussi de couleur de brume. */
export function cieDe(ambiance: ThemePlateau['ambiance']) {
  if (ambiance === 'mer') return { haut: '#1f7fcf', bas: '#b9e8ff' };
  if (ambiance === 'plateforme') return { haut: '#1f8a9c', bas: '#9be3e6' };
  if (ambiance === 'gymnase') return { haut: '#141b2b', bas: '#2a3550' };
  if (ambiance === 'ile') return { haut: '#2a9fd8', bas: '#c8f2ff' };
  return { haut: '#4fb3f2', bas: '#dff6ff' };
}

interface Taille {
  largeur: number;
  hauteur: number;
}

/** Des points tirés au hasard autour du plateau, jamais sur lui (le carré du plateau est exclu). */
function autour(n: number, largeur: number, hauteur: number, marge: number, rayon: number, graine: number) {
  const r = hasard(graine);
  const demiL = largeur / 2 + marge;
  const demiH = hauteur / 2 + marge;
  const points: Array<{ x: number; z: number; aleat: number }> = [];
  for (let essais = 0; points.length < n && essais < n * 60; essais++) {
    const x = (r() * 2 - 1) * rayon;
    const z = (r() * 2 - 1) * rayon;
    if (Math.abs(x) < demiL && Math.abs(z) < demiH) continue;
    points.push({ x, z, aleat: r() });
  }
  return points;
}

/** Le décor qui entoure le plateau, selon le lieu. */
export function Environnement({ theme, taille, reduced }: { theme: ThemePlateau; taille: Taille; reduced: boolean }) {
  const cie = cieDe(theme.ambiance);
  return (
    <>
      <Ciel haut={cie.haut} bas={cie.bas} />
      {theme.ambiance === 'mer' && <Mer theme={theme} taille={taille} reduced={reduced} />}
      {theme.ambiance === 'mer' && <Glacons taille={taille} />}
      {theme.ambiance === 'plateforme' && <Plateforme taille={taille} reduced={reduced} />}
      {theme.ambiance === 'pelouse' && <Pelouse theme={theme} taille={taille} />}
      {theme.ambiance === 'gymnase' && <Gymnase taille={taille} />}
      {theme.ambiance === 'ile' && <Ile theme={theme} taille={taille} reduced={reduced} />}
      {(theme.ambiance === 'pelouse' || theme.ambiance === 'mer' || theme.ambiance === 'ile') && <Nuages />}
      {/* Les fonds : ce qui ferme le paysage à l’horizon. */}
      {theme.ambiance === 'pelouse' && <CollinesLointaines couleur={nuancerVert(theme.sol)} />}
      {theme.ambiance === 'mer' && <IlesLointaines y={SURFACE_MER} palmiers />}
      {theme.ambiance === 'ile' && <IlesLointaines y={-0.95} palmiers={false} />}
      {theme.ambiance === 'plateforme' && <TourLointaines />}
      {theme.ambiance === 'gymnase' && <Gradins taille={taille} />}
      {(theme.ambiance === 'plateforme' || theme.ambiance === 'gymnase') && <Etoiles />}
      {/* La vie : des bêtes et des lumières qui bougent autour du plateau. */}
      {(theme.ambiance === 'pelouse' || theme.ambiance === 'mer' || theme.ambiance === 'ile') && (
        <Oiseaux reduced={reduced} />
      )}
      {theme.ambiance === 'mer' && <Poissons taille={taille} reduced={reduced} />}
      {(theme.ambiance === 'plateforme' || theme.ambiance === 'gymnase') && (
        <Lucioles taille={taille} reduced={reduced} />
      )}
    </>
  );
}

/** Un dôme de ciel en dégradé : haut plus clair, horizon plus pâle. */
function Ciel({ haut, bas }: { haut: string; bas: string }) {
  const geometrie = useMemo(() => {
    const g = new THREE.SphereGeometry(70, 32, 16);
    const pos = g.attributes.position;
    const couleurs = new Float32Array(pos.count * 3);
    const cHaut = new THREE.Color(haut);
    const cBas = new THREE.Color(bas);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 45, 0, 1);
      c.copy(cBas).lerp(cHaut, t);
      couleurs.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
    return g;
  }, [haut, bas]);
  useEffect(() => () => geometrie.dispose(), [geometrie]);
  return (
    <mesh geometry={geometrie} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

/** Quelques nuages flottants, derrière et sur les côtés : jamais entre la caméra et le plateau. */
const NUAGES: Array<[number, number, number, number]> = [
  [-16, 9, -16, 1.2],
  [6, 10, -20, 1.6],
  [18, 8, -14, 1.1],
  [-24, 7, 2, 1.3],
  [26, 9, 4, 1.5],
];

function Nuages() {
  const blanc = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), []);
  return (
    <group>
      {NUAGES.map(([x, y, z, s], i) => (
        <group key={i} position={[x, y, z]} scale={s}>
          {[
            [0, 0, 0, 1],
            [0.95, -0.15, 0.1, 0.75],
            [-0.9, -0.2, -0.05, 0.8],
            [0.3, 0.5, 0, 0.7],
          ].map(([px, py, pz, r], j) => (
            <Forme
              key={j}
              geometrie={GEO.sphere}
              materiau={blanc}
              contour={0}
              position={[px ?? 0, py ?? 0, pz ?? 0]}
              scale={r ?? 1}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

const COULEURS_FLEURS = ['#ff5d8f', '#ffd23f', '#ffffff', '#b67aff', '#ff9f1c'];
const COULEURS_PAPILLONS = ['#ff6fb1', '#ffd23f', '#6ee7ff', '#b67aff'];
/** Hauteur du sol de la jungle, sous le plateau. */
const SOL_ILE = -0.4;

function Pelouse({ theme, taille }: { theme: ThemePlateau; taille: Taille }) {
  const grand = Math.max(taille.largeur, taille.hauteur);
  const arbres = useMemo(
    () => autour(14, taille.largeur, taille.hauteur, 2.5, 17, 11),
    [taille.largeur, taille.hauteur],
  );
  const fleurs = useMemo(
    () => autour(28, taille.largeur, taille.hauteur, 0.7, grand / 2 + 5, 53),
    [taille.largeur, taille.hauteur, grand],
  );
  const champignons = useMemo(
    () => autour(5, taille.largeur, taille.hauteur, 0.8, grand / 2 + 4, 61),
    [taille.largeur, taille.hauteur, grand],
  );
  const collines = useMemo(
    () =>
      autour(9, taille.largeur, taille.hauteur, 18, 84, 71).filter(
        (p) => p.z < 0 || Math.abs(p.x) > taille.largeur / 2 + 18,
      ),
    [taille.largeur, taille.hauteur],
  );
  const sol = useMemo(() => {
    const t = texHerbe(theme.sol, 3);
    t.repeat.set(30, 30);
    return t;
  }, [theme.sol]);
  const feuillage = useMemo(() => {
    const t = texFeuillage(theme.mur.couleur, 17);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  }, [theme.mur.couleur]);
  const solMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sol, roughness: 1 }), [sol]);
  useEffect(
    () => () => {
      sol.dispose();
      solMat.dispose();
      feuillage.map?.dispose();
      feuillage.dispose();
    },
    [sol, solMat, feuillage],
  );
  const colline = useMemo(
    () => new THREE.MeshStandardMaterial({ color: nuancerVert(theme.sol), roughness: 1 }),
    [theme.sol],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SOL_PELOUSE, 0]} receiveShadow material={solMat}>
        <planeGeometry args={[140, 140]} />
      </mesh>
      {collines.map((p, i) => (
        <mesh
          key={`h${i}`}
          position={[p.x, SOL_PELOUSE - 2, p.z]}
          scale={[11 + p.aleat * 8, 3.5 + p.aleat * 2.5, 11 + p.aleat * 8]}
          material={colline}
        >
          <sphereGeometry args={[1, 18, 12]} />
        </mesh>
      ))}
      {arbres.map((p, i) => (
        <Arbre key={`a${i}`} x={p.x} z={p.z} taille={0.9 + p.aleat * 0.6} feuillage={feuillage} />
      ))}
      {fleurs.map((p, i) => (
        <Fleur
          key={`f${i}`}
          x={p.x}
          z={p.z}
          couleur={COULEURS_FLEURS[Math.floor(p.aleat * COULEURS_FLEURS.length)] ?? '#ffffff'}
        />
      ))}
      {champignons.map((p, i) => (
        <Champignon key={`c${i}`} x={p.x} z={p.z} taille={0.9 + p.aleat * 0.4} />
      ))}
      <RochersDecor taille={taille} nombre={12} couleur="#8f9187" graine={29} y={SOL_PELOUSE} />
      {theme.id === 'fete' && <Guirlande taille={taille} />}
    </group>
  );
}

/** Une teinte de vert plus sombre que le sol, pour le lointain des collines. */
function nuancerVert(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.82);
  const g = Math.round(((n >> 8) & 255) * 0.9);
  const b = Math.round((n & 255) * 0.82);
  return `rgb(${r},${g},${b})`;
}

function Arbre({ x, z, taille, feuillage }: { x: number; z: number; taille: number; feuillage: THREE.Material }) {
  const ecorce = useMemo(() => new THREE.MeshToonMaterial({ color: '#8a5a33' }), []);
  return (
    <group position={[x, SOL_PELOUSE, z]} scale={taille}>
      <Forme geometrie={GEO.cylindre} materiau={ecorce} contour={0.05} position={[0, 0.5, 0]} scale={[0.14, 1, 0.14]} />
      <Forme geometrie={GEO.sphere} materiau={feuillage} contour={0.045} position={[0, 1.45, 0]} scale={0.85} />
      <Forme geometrie={GEO.sphere} materiau={feuillage} contour={0.045} position={[0.38, 1.9, 0.2]} scale={0.4} />
      <Forme geometrie={GEO.sphere} materiau={feuillage} contour={0.045} position={[-0.3, 1.8, -0.2]} scale={0.36} />
    </group>
  );
}

function Fleur({ x, z, couleur }: { x: number; z: number; couleur: string }) {
  const tige = useMemo(() => new THREE.MeshToonMaterial({ color: '#2e7d32' }), []);
  const tete = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  return (
    <group position={[x, SOL_PELOUSE, z]}>
      <mesh position={[0, 0.17, 0]} geometry={GEO.cylindre} material={tige} scale={[0.025, 0.34, 0.025]} />
      <mesh position={[0, 0.36, 0]} geometry={GEO.sphere} material={tete} scale={0.13} />
    </group>
  );
}

function Champignon({ x, z, taille }: { x: number; z: number; taille: number }) {
  const pied = useMemo(() => new THREE.MeshToonMaterial({ color: '#fff4e0' }), []);
  const chapeau = useMemo(() => new THREE.MeshToonMaterial({ color: '#e5383b' }), []);
  const point = useMemo(() => new THREE.MeshToonMaterial({ color: '#ffffff' }), []);
  return (
    <group position={[x, SOL_PELOUSE, z]} scale={taille}>
      <Forme geometrie={GEO.cylindre} materiau={pied} contour={0.05} position={[0, 0.15, 0]} scale={[0.1, 0.3, 0.1]} />
      <Forme geometrie={GEO.dome} materiau={chapeau} contour={0.06} position={[0, 0.3, 0]} scale={0.25} />
      {[
        [0.12, 0.36, 0.05],
        [-0.1, 0.38, -0.06],
        [0.02, 0.44, 0.1],
      ].map(([px, py, pz], i) => (
        <mesh key={i} position={[px ?? 0, py ?? 0, pz ?? 0]} geometry={GEO.sphere} material={point} scale={0.05} />
      ))}
    </group>
  );
}

function Mer({ theme, taille, reduced }: { theme: ThemePlateau; taille: Taille; reduced: boolean }) {
  const eau = useRef<THREE.Mesh>(null);
  const banquise = useMemo(
    () => autour(12, taille.largeur, taille.hauteur, 1.5, 16, 23),
    [taille.largeur, taille.hauteur],
  );
  const iles = useMemo(() => autour(4, taille.largeur, taille.hauteur, 22, 60, 83), [taille.largeur, taille.hauteur]);
  const pingouins = useMemo(
    () => autour(6, taille.largeur, taille.hauteur, 1.2, 9, 41),
    [taille.largeur, taille.hauteur],
  );
  const geometrieEau = useMemo(() => {
    const g = new THREE.PlaneGeometry(150, 150, 56, 56);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const base = useMemo(
    () => Float32Array.from(geometrieEau.attributes.position.array as ArrayLike<number>),
    [geometrieEau],
  );
  const materiauEau = useMemo(
    () => new THREE.MeshStandardMaterial({ color: theme.eau, roughness: 0.18, metalness: 0.2 }),
    [theme.eau],
  );
  const glace = useMemo(() => {
    const t = texGlace(theme.ciel, 31);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  }, [theme.ciel]);
  const sable = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f0d9a0', roughness: 1 }), []);
  const herbe = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7bc043', roughness: 1 }), []);
  const blanc = useMemo(() => new THREE.MeshToonMaterial({ color: '#ffffff' }), []);
  useEffect(
    () => () => {
      geometrieEau.dispose();
      materiauEau.dispose();
      glace.map?.dispose();
      glace.dispose();
    },
    [geometrieEau, materiauEau, glace],
  );
  useFrame((state) => {
    // La mer ondule : chaque point de l’eau monte et descend selon sa place et le temps.
    if (reduced || !eau.current) return;
    const t = state.clock.elapsedTime;
    const pos = geometrieEau.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] ?? 0;
      const z = base[i * 3 + 2] ?? 0;
      pos.setY(i, Math.sin(x * 0.45 + t * 1.1) * 0.05 + Math.cos(z * 0.35 + t * 0.8) * 0.04);
    }
    pos.needsUpdate = true;
    geometrieEau.computeVertexNormals();
  });
  return (
    <group>
      <mesh ref={eau} geometry={geometrieEau} material={materiauEau} position={[0, SURFACE_MER, 0]} receiveShadow />
      {banquise.map((p, i) => (
        <group key={`b${i}`} position={[p.x, SURFACE_MER + 0.05, p.z]} rotation={[0, p.aleat * 3, 0]}>
          <Forme
            geometrie={GEO.cylindre}
            materiau={glace}
            contour={0.035}
            scale={[0.95 + p.aleat * 0.8, 0.14, 0.95 + p.aleat * 0.8]}
          />
        </group>
      ))}
      {iles.map((p, i) => (
        <group key={`i${i}`} position={[p.x, SURFACE_MER, p.z]}>
          <Forme geometrie={GEO.rocher} materiau={sable} contour={0.03} scale={[7, 2.4, 7]} />
          <Forme
            geometrie={GEO.rocher}
            materiau={herbe}
            contour={0.03}
            position={[0, 1.4, 0]}
            scale={[5.2, 1.4, 5.2]}
          />
          <Palmier x={1.6 + p.aleat} z={-1.2} />
          <Palmier x={-1.4} z={1.2 + p.aleat} />
        </group>
      ))}
      {pingouins.map((p, i) => (
        <Pingouin key={`p${i}`} x={p.x} z={p.z} aleat={p.aleat} reduced={reduced} blanc={blanc} />
      ))}
      <Igloo x={-9} z={-7} blanc={blanc} />
      <Igloo x={10} z={-9} blanc={blanc} />
    </group>
  );
}

function Palmier({ x, z }: { x: number; z: number }) {
  const bois = useMemo(() => new THREE.MeshToonMaterial({ color: '#9a6b3c' }), []);
  const feuille = useMemo(() => new THREE.MeshToonMaterial({ color: '#2f9e44' }), []);
  return (
    <group position={[x, 2.4, z]}>
      <Forme geometrie={GEO.cylindre} materiau={bois} contour={0.04} position={[0, 0.8, 0]} scale={[0.1, 1.6, 0.1]} />
      {[0, 1.3, 2.6, 3.9].map((a) => (
        <Forme
          key={a}
          geometrie={GEO.sphere}
          materiau={feuille}
          contour={0.05}
          position={[Math.cos(a) * 0.5, 1.7, Math.sin(a) * 0.5]}
          rotation={[0, -a, 0]}
          scale={[0.55, 0.12, 0.2]}
        />
      ))}
    </group>
  );
}

function Igloo({ x, z, blanc }: { x: number; z: number; blanc: THREE.Material }) {
  const porte = useMemo(() => new THREE.MeshToonMaterial({ color: '#1d3557' }), []);
  return (
    <group position={[x, SURFACE_MER, z]}>
      <Forme geometrie={GEO.dome} materiau={blanc} contour={0.04} scale={[2.2, 1.8, 2.2]} />
      <mesh position={[0, 0.35, 1.8]} geometry={GEO.cube} material={porte} scale={[0.7, 0.7, 0.2]} />
    </group>
  );
}

/** Un pingouin : corps sombre, ventre blanc, bec orange. Il se dandine sur sa plaque (sans collision). */
function Pingouin({
  x,
  z,
  aleat,
  reduced,
  blanc,
}: {
  x: number;
  z: number;
  aleat: number;
  reduced: boolean;
  blanc: THREE.Material;
}) {
  const ref = useRef<THREE.Group>(null);
  const corps = useMemo(() => new THREE.MeshToonMaterial({ color: '#1d1d2b' }), []);
  const bec = useMemo(() => new THREE.MeshToonMaterial({ color: '#ff9f1c' }), []);
  useFrame((state) => {
    if (reduced || !ref.current) return;
    ref.current.position.y = SURFACE_MER + 0.22 + Math.sin(state.clock.elapsedTime * 2.2 + aleat * 9) * 0.03;
  });
  return (
    <group ref={ref} position={[x, SURFACE_MER + 0.22, z]} rotation={[0, aleat * 6, 0]}>
      <Forme geometrie={GEO.sphere} materiau={corps} contour={0.05} scale={[0.16, 0.26, 0.16]} />
      <mesh position={[0, 0.02, 0.1]} geometry={GEO.sphere} material={blanc} scale={[0.1, 0.18, 0.06]} />
      <mesh
        position={[0, 0.2, 0.15]}
        geometry={GEO.cone}
        material={bec}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.04, 0.09, 0.04]}
      />
    </group>
  );
}

/**
 * L’arène : des bulles translucides flottent autour du plateau, au-dessus d’un vide turquoise. Le plateau
 * a son anneau orangé (dans socleDe) ; ici, seulement le décor qui l’entoure.
 */
function Bulles({ taille, reduced }: { taille: Taille; reduced: boolean }) {
  const points = useMemo(
    () => autour(22, taille.largeur, taille.hauteur, 1.8, 17, 67),
    [taille.largeur, taille.hauteur],
  );
  const hauteurs = useMemo(() => points.map((p) => 1 + p.aleat * 7), [points]);
  const groupes = useRef<Array<THREE.Group | null>>([]);
  const materiau = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e9fbff',
        transparent: true,
        opacity: 0.5,
        roughness: 0.08,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => materiau.dispose(), [materiau]);
  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    hauteurs.forEach((h, i) => {
      const g = groupes.current[i];
      if (g) g.position.y = h + Math.sin(t * 0.8 + i) * 0.25;
    });
  });
  return (
    <group>
      {points.map((p, i) => (
        <group
          key={i}
          ref={(g) => {
            groupes.current[i] = g;
          }}
          position={[p.x, hauteurs[i] ?? 1, p.z]}
        >
          <mesh geometry={GEO.sphere} material={materiau} scale={0.5 + p.aleat * 0.9} />
        </group>
      ))}
    </group>
  );
}

/** Une palme de palmier au sommet d’un tronc incliné, avec quelques noix de coco. */
function PalmierJungle({ x, z, inclinaison }: { x: number; z: number; inclinaison: number }) {
  const bois = useMemo(() => new THREE.MeshToonMaterial({ color: '#9a6b3c' }), []);
  const feuille = useMemo(() => new THREE.MeshToonMaterial({ color: '#2f9e44' }), []);
  const coco = useMemo(() => new THREE.MeshToonMaterial({ color: '#6b4226' }), []);
  return (
    <group position={[x, SOL_ILE, z]} rotation={[inclinaison, 0, inclinaison * 0.6]}>
      <Forme geometrie={GEO.cylindre} materiau={bois} contour={0.04} position={[0, 1.6, 0]} scale={[0.14, 3.2, 0.14]} />
      {[0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4].map((a) => (
        <Forme
          key={a}
          geometrie={GEO.sphere}
          materiau={feuille}
          contour={0.05}
          position={[Math.cos(a) * 0.75, 3.3, Math.sin(a) * 0.75]}
          rotation={[0.35, -a, 0]}
          scale={[1.3, 0.1, 0.32]}
        />
      ))}
      {[0, 1.6, 3.2].map((a) => (
        <Forme
          key={a}
          geometrie={GEO.sphere}
          materiau={coco}
          contour={0.04}
          position={[Math.cos(a) * 0.14, 3.05, Math.sin(a) * 0.14]}
          scale={0.14}
        />
      ))}
    </group>
  );
}

/** Une fougère : des frondes fines qui s’écartent du pied. */
function Fougere({ x, z, couleur }: { x: number; z: number; couleur: string }) {
  const vert = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  return (
    <group position={[x, SOL_ILE, z]}>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <Forme
            key={i}
            geometrie={GEO.cone}
            materiau={vert}
            contour={0.05}
            position={[Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18]}
            rotation={[Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]}
            scale={[0.12, 0.8, 0.12]}
          />
        );
      })}
    </group>
  );
}

/** Un papillon qui virevolte autour de son point de départ : les ailes battent, le corps tourne. */
function Papillon({
  x,
  z,
  couleur,
  phase,
  reduced,
}: {
  x: number;
  z: number;
  couleur: string;
  phase: number;
  reduced: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const aile = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  useFrame((state) => {
    if (reduced || !ref.current) return;
    const t = state.clock.elapsedTime + phase;
    ref.current.position.set(x + Math.cos(t * 0.6) * 0.7, 1.1 + Math.sin(t * 1.4) * 0.2, z + Math.sin(t * 0.6) * 0.7);
    ref.current.rotation.y = -t * 0.6;
  });
  return (
    <group ref={ref} position={[x, 1.1, z]}>
      <mesh geometry={GEO.sphere} scale={[0.04, 0.04, 0.12]}>
        <meshToonMaterial color="#222222" />
      </mesh>
      <mesh geometry={GEO.sphere} material={aile} position={[0.1, 0, 0]} scale={[0.1, 0.01, 0.12]} />
      <mesh geometry={GEO.sphere} material={aile} position={[-0.1, 0, 0]} scale={[0.1, 0.01, 0.12]} />
    </group>
  );
}

/** Une île tropicale : une mer qui ondule, une plage, une jungle sous le plateau, et des palmiers, arbres, fougères, fleurs, rochers et papillons. */
function Ile({ theme, taille, reduced }: { theme: ThemePlateau; taille: Taille; reduced: boolean }) {
  const eau = useRef<THREE.Mesh>(null);
  // Les éléments sont tirés au hasard, puis gardés à l’intérieur de l’île (une ellipse).
  const dansIle = (p: { x: number; z: number }) => (p.x / 12.5) ** 2 + (p.z / 10.5) ** 2 <= 1;
  const palmiers = useMemo(
    () => autour(12, taille.largeur, taille.hauteur, 2, 13.5, 131).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const arbres = useMemo(
    () => autour(18, taille.largeur, taille.hauteur, 2, 13.5, 137).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const fougeres = useMemo(
    () => autour(30, taille.largeur, taille.hauteur, 1.5, 13.5, 139).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const fleurs = useMemo(
    () => autour(40, taille.largeur, taille.hauteur, 1, 13.5, 149).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const rochers = useMemo(
    () => autour(4, taille.largeur, taille.hauteur, 3, 13.5, 151).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const papillons = useMemo(
    () => autour(8, taille.largeur, taille.hauteur, 2.5, 12, 157).filter(dansIle),
    [taille.largeur, taille.hauteur],
  );
  const geometrieEau = useMemo(() => {
    const g = new THREE.PlaneGeometry(150, 150, 48, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const base = useMemo(
    () => Float32Array.from(geometrieEau.attributes.position.array as ArrayLike<number>),
    [geometrieEau],
  );
  const materiauEau = useMemo(
    () => new THREE.MeshStandardMaterial({ color: theme.eau, roughness: 0.2, metalness: 0.1 }),
    [theme.eau],
  );
  const herbe = useMemo(() => {
    const t = texHerbe(theme.sol, 61);
    t.repeat.set(3, 3);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
  }, [theme.sol]);
  const sable = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e9d28a', roughness: 1 }), []);
  const terre = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 }), []);
  const feuillage = useMemo(
    () => new THREE.MeshStandardMaterial({ map: texFeuillage(theme.mur.couleur, 41), roughness: 0.9 }),
    [theme.mur.couleur],
  );
  const roche = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b7078', roughness: 1 }), []);
  useEffect(
    () => () => {
      geometrieEau.dispose();
      materiauEau.dispose();
      herbe.map?.dispose();
      herbe.dispose();
      sable.dispose();
      terre.dispose();
      feuillage.map?.dispose();
      feuillage.dispose();
      roche.dispose();
    },
    [geometrieEau, materiauEau, herbe, sable, terre, feuillage, roche],
  );
  useFrame((state) => {
    if (reduced || !eau.current) return;
    const t = state.clock.elapsedTime;
    const pos = eau.current.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] ?? 0;
      const z = base[i * 3 + 2] ?? 0;
      pos.setY(i, Math.sin(x * 0.5 + t * 1.2) * 0.05 + Math.cos(z * 0.4 + t) * 0.04);
    }
    pos.needsUpdate = true;
  });
  const couleursFougere = ['#2f9e44', '#3fae52', '#237a35'];
  return (
    <group>
      {/* La mer, puis la plage, puis la jungle qui forme l’île. */}
      <mesh ref={eau} geometry={geometrieEau} material={materiauEau} position={[0, -0.95, 0]} receiveShadow />
      <mesh
        geometry={GEO.disque}
        material={[terre, sable, terre]}
        position={[0, -1.1, 0]}
        scale={[16.5, 0.6, 14.5]}
        receiveShadow
      />
      <mesh
        geometry={GEO.disque}
        material={[terre, herbe, terre]}
        position={[0, -0.85, 0]}
        scale={[13.5, 0.9, 11.5]}
        receiveShadow
      />
      {palmiers.map((p, i) => (
        <PalmierJungle key={`p${i}`} x={p.x} z={p.z} inclinaison={(p.aleat - 0.5) * 0.2} />
      ))}
      {arbres.map((p, i) => (
        <Arbre key={`a${i}`} x={p.x} z={p.z} taille={1 + p.aleat * 0.5} feuillage={feuillage} />
      ))}
      {fougeres.map((p, i) => (
        <Fougere key={`f${i}`} x={p.x} z={p.z} couleur={couleursFougere[Math.floor(p.aleat * 3)] ?? '#2f9e44'} />
      ))}
      {fleurs.map((p, i) => (
        <Fleur
          key={`l${i}`}
          x={p.x}
          z={p.z}
          couleur={COULEURS_FLEURS[Math.floor(p.aleat * COULEURS_FLEURS.length)] ?? '#ffffff'}
        />
      ))}
      {rochers.map((p, i) => (
        <Forme
          key={`r${i}`}
          geometrie={GEO.rocher}
          materiau={roche}
          contour={0.03}
          position={[p.x, SOL_ILE + 0.3, p.z]}
          rotation={[p.aleat, p.aleat * 2, 0]}
          scale={0.9 + p.aleat * 0.8}
        />
      ))}
      {papillons.map((p, i) => (
        <Papillon
          key={`b${i}`}
          x={p.x}
          z={p.z}
          couleur={COULEURS_PAPILLONS[Math.floor(p.aleat * COULEURS_PAPILLONS.length)] ?? '#ff6fb1'}
          phase={i * 1.7}
          reduced={reduced}
        />
      ))}
    </group>
  );
}

/** Une salle d’escalade : un sol sombre sous le tapis, loin sous le plateau. */
/** Des rochers posés au hasard autour du plateau, à demi enfouis dans le sol. */
function RochersDecor({
  taille,
  nombre,
  couleur,
  graine,
  y,
}: {
  taille: Taille;
  nombre: number;
  couleur: string;
  graine: number;
  y: number;
}) {
  const pierre = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  useEffect(() => () => pierre.dispose(), [pierre]);
  const pts = useMemo(
    () => autour(nombre, taille.largeur, taille.hauteur, 2.2, 18, graine),
    [nombre, taille.largeur, taille.hauteur, graine],
  );
  return (
    <group>
      {pts.map((p, i) => (
        <Forme
          key={i}
          geometrie={GEO.rocher}
          materiau={pierre}
          contour={0.035}
          position={[p.x, y + 0.2, p.z]}
          rotation={[0, p.aleat * 6, 0]}
          scale={[0.7 + p.aleat * 0.8, 0.45 + p.aleat * 0.35, 0.6 + p.aleat * 0.7]}
        />
      ))}
    </group>
  );
}

/** Un segment horizontal entre deux points du sol, en fil fin. */
function Segment({
  a,
  b,
  y,
  materiau,
}: {
  a: [number, number];
  b: [number, number];
  y: number;
  materiau: THREE.Material;
}) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const longueur = Math.hypot(dx, dz);
  const q = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize()),
    [dx, dz],
  );
  return (
    <mesh
      geometry={GEO.cylindre}
      material={materiau}
      position={[(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2]}
      quaternion={q}
      scale={[0.022, longueur, 0.022]}
    />
  );
}

/** Une guirlande de fanions autour de la fête : quatre mâts, un fil sur chaque côté. */
function Guirlande({ taille }: { taille: Taille }) {
  const hauteur = 1.5;
  const dx = taille.largeur / 2 + 1.8;
  const dz = taille.hauteur / 2 + 1.8;
  const coins: Array<[number, number]> = [
    [-dx, -dz],
    [dx, -dz],
    [dx, dz],
    [-dx, dz],
  ];
  const bois = useMemo(() => new THREE.MeshToonMaterial({ color: '#7a4e2d' }), []);
  const fil = useMemo(() => new THREE.MeshToonMaterial({ color: '#3b2a1e' }), []);
  const fanions = useMemo(
    () => ['#ff5d8f', '#ffd23f', '#6ee7ff', '#b67aff', '#ff9f1c'].map((c) => new THREE.MeshToonMaterial({ color: c })),
    [],
  );
  useEffect(
    () => () => {
      bois.dispose();
      fil.dispose();
      fanions.forEach((f) => f.dispose());
    },
    [bois, fil, fanions],
  );
  const cotes = coins.map((a, i) => [a, coins[(i + 1) % coins.length] ?? a] as const);
  const pieces = cotes.flatMap(([a, b], c) =>
    Array.from({ length: 9 }, (_, k) => {
      const t = (k + 0.5) / 9;
      return {
        key: `${c}-${k}`,
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        materiau: fanions[(c * 3 + k) % fanions.length] ?? fanions[0],
      };
    }),
  );
  return (
    <group>
      {coins.map(([x, z], i) => (
        <mesh
          key={`m${i}`}
          geometry={GEO.cylindre}
          material={bois}
          position={[x, SOL_PELOUSE + hauteur / 2, z]}
          scale={[0.05, hauteur, 0.05]}
        />
      ))}
      {cotes.map(([a, b], i) => (
        <Segment key={`s${i}`} a={a} b={b} y={SOL_PELOUSE + hauteur - 0.05} materiau={fil} />
      ))}
      {pieces.map((f) => (
        <mesh
          key={f.key}
          geometry={GEO.cone}
          material={f.materiau}
          position={[f.x, SOL_PELOUSE + hauteur - 0.2, f.z]}
          rotation={[Math.PI, 0, 0]}
          scale={[0.13, 0.24, 0.13]}
        />
      ))}
    </group>
  );
}

/** Des glaçons qui flottent sur la mer, autour du plateau. */
function Glacons({ taille }: { taille: Taille }) {
  const glace = useMemo(() => new THREE.MeshStandardMaterial({ color: '#eefbff', roughness: 0.35 }), []);
  useEffect(() => () => glace.dispose(), [glace]);
  const pts = useMemo(() => autour(12, taille.largeur, taille.hauteur, 3, 26, 97), [taille.largeur, taille.hauteur]);
  return (
    <group>
      {pts.map((p, i) => (
        <Forme
          key={i}
          geometrie={GEO.bloc}
          materiau={glace}
          contour={0.03}
          position={[p.x, SURFACE_MER + 0.04, p.z]}
          rotation={[0, p.aleat * 6.28, 0]}
          scale={[1.4 + p.aleat * 1.6, 0.16, 1.1 + p.aleat]}
        />
      ))}
    </group>
  );
}

/** Des îlots de pierre et d’herbe qui flottent dans le vide, sous le plateau. */
function IlotsFlottants({ taille }: { taille: Taille }) {
  const roche = useMemo(() => new THREE.MeshToonMaterial({ color: '#5b6b7d' }), []);
  const herbe = useMemo(() => new THREE.MeshToonMaterial({ color: '#7fb86a' }), []);
  useEffect(
    () => () => {
      roche.dispose();
      herbe.dispose();
    },
    [roche, herbe],
  );
  const pts = useMemo(() => autour(6, taille.largeur, taille.hauteur, 8, 46, 113), [taille.largeur, taille.hauteur]);
  return (
    <group>
      {pts.map((p, i) => {
        const t = 2.5 + p.aleat * 3;
        return (
          <group key={i} position={[p.x, -4.2 - p.aleat * 1.2, p.z]}>
            <Forme geometrie={GEO.rocher} materiau={roche} contour={0.04} scale={[t, t * 0.7, t]} />
            <Forme
              geometrie={GEO.dome}
              materiau={herbe}
              contour={0.04}
              position={[0, t * 0.55, 0]}
              scale={[t * 0.95, t * 0.2, t * 0.95]}
            />
          </group>
        );
      })}
    </group>
  );
}

/** Des points répartis sur un anneau lointain, autour du plateau. */
function anneau(n: number, rmin: number, rmax: number, graine: number) {
  const r = hasard(graine);
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const rayon = rmin + r() * (rmax - rmin);
    return { x: Math.cos(angle) * rayon, z: Math.sin(angle) * rayon, aleat: r(), angle };
  });
}

/** Des collines lointaines, à l’horizon de la pelouse. */
function CollinesLointaines({ couleur }: { couleur: string }) {
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  useEffect(() => () => mat.dispose(), [mat]);
  const pts = useMemo(() => anneau(14, 21, 27, 201), []);
  return (
    <group>
      {pts.map((p, i) => (
        <mesh
          key={i}
          geometry={GEO.sphere}
          material={mat}
          position={[p.x, SOL_PELOUSE - 1, p.z]}
          scale={[5 + p.aleat * 4, 4 + p.aleat * 4, 5 + p.aleat * 4]}
        />
      ))}
    </group>
  );
}

/** Des îles lointaines, avec du sable et de l’herbe, et des palmiers si le lieu en a. */
function IlesLointaines({ y, palmiers }: { y: number; palmiers: boolean }) {
  const sable = useMemo(() => new THREE.MeshToonMaterial({ color: '#e9d28a' }), []);
  const herbe = useMemo(() => new THREE.MeshToonMaterial({ color: '#4f9a3a' }), []);
  useEffect(
    () => () => {
      sable.dispose();
      herbe.dispose();
    },
    [sable, herbe],
  );
  const pts = useMemo(() => anneau(9, 20, 26, 207), []);
  return (
    <group>
      {pts.map((p, i) => {
        const t = 1.6 + p.aleat * 1.6;
        return (
          <group key={i}>
            <mesh geometry={GEO.rocher} material={sable} position={[p.x, y - 0.2, p.z]} scale={[t, 0.9, t]} />
            <mesh geometry={GEO.dome} material={herbe} position={[p.x, y + 0.3, p.z]} scale={[t * 0.8, 1.2, t * 0.8]} />
            {palmiers && <Palmier x={p.x + t * 0.3} z={p.z + t * 0.2} />}
          </group>
        );
      })}
    </group>
  );
}

/** Des tours de pierre très hautes, au loin, dans le vide : elles montent du fond jusqu’au ciel. */
function TourLointaines() {
  const roche = useMemo(() => new THREE.MeshToonMaterial({ color: '#34506a' }), []);
  useEffect(() => () => roche.dispose(), [roche]);
  const pts = useMemo(() => anneau(9, 21, 27, 211), []);
  return (
    <group>
      {pts.map((p, i) => {
        const h = 8 + p.aleat * 14;
        return (
          <mesh
            key={i}
            geometry={GEO.rocher}
            material={roche}
            position={[p.x, h - 10, p.z]}
            scale={[1.5 + p.aleat * 1.5, h, 1.5 + p.aleat * 1.5]}
          />
        );
      })}
    </group>
  );
}

/** Quelques étoiles dans le haut du ciel. */
function Etoiles() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const pts = useMemo(() => {
    const r = hasard(301);
    return Array.from({ length: 40 }, () => {
      const theta = r() * Math.PI * 2;
      const phi = 0.15 + r() * 0.9;
      const R = 60;
      return {
        x: Math.sin(phi) * Math.cos(theta) * R,
        y: Math.cos(phi) * R,
        z: Math.sin(phi) * Math.sin(theta) * R,
        s: 0.12 + r() * 0.18,
      };
    });
  }, []);
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} geometry={GEO.sphere} material={mat} position={[p.x, p.y, p.z]} scale={p.s} />
      ))}
    </group>
  );
}

/** Des gradins au fond du gymnase, garnis de spectateurs colorés. */
function Gradins({ taille }: { taille: Taille }) {
  const marches = useMemo(
    () => [new THREE.MeshToonMaterial({ color: '#2d3a5c' }), new THREE.MeshToonMaterial({ color: '#3a4a74' })],
    [],
  );
  const public_ = useMemo(
    () => ['#ff5d8f', '#ffd23f', '#6ee7ff', '#b67aff', '#ff9f1c'].map((c) => new THREE.MeshToonMaterial({ color: c })),
    [],
  );
  useEffect(
    () => () => {
      marches.forEach((m) => m.dispose());
      public_.forEach((m) => m.dispose());
    },
    [marches, public_],
  );
  const largeur = Math.max(36, taille.largeur * 1.8);
  const rangees = [0, 1, 2, 3];
  return (
    <group>
      {rangees.map((k) => {
        const z = -15 - k * 1.8;
        const y = -3 + 0.6 + k * 1.2;
        return (
          <group key={k}>
            <mesh
              geometry={GEO.cube}
              material={marches[k % 2] ?? marches[0]}
              position={[0, y, z]}
              scale={[largeur, 1.2, 2.2]}
            />
            {Array.from({ length: 30 }, (_, i) => {
              const x = -largeur / 2 + 1.5 + i * ((largeur - 3) / 29);
              return (
                <mesh
                  key={i}
                  geometry={GEO.sphere}
                  material={public_[(i + k) % public_.length] ?? public_[0]}
                  position={[x, y + 0.75, z]}
                  scale={0.42}
                />
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

/** Un oiseau qui tourne en cercle au-dessus du plateau, les ailes qui battent. */
function Oiseau({
  angle0,
  rayon,
  vitesse,
  hauteur,
  phase,
  reduced,
}: {
  angle0: number;
  rayon: number;
  vitesse: number;
  hauteur: number;
  phase: number;
  reduced: boolean;
}) {
  const corps = useRef<THREE.Group>(null);
  const aileG = useRef<THREE.Group>(null);
  const aileD = useRef<THREE.Group>(null);
  const plume = useMemo(() => new THREE.MeshToonMaterial({ color: '#2d3142' }), []);
  useEffect(() => () => plume.dispose(), [plume]);
  useFrame((state) => {
    const g = corps.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const a = reduced ? angle0 : angle0 + t * vitesse;
    g.position.set(Math.cos(a) * rayon, hauteur + (reduced ? 0 : Math.sin(t * 1.3 + phase) * 0.3), Math.sin(a) * rayon);
    // Le bec suit la tangente du cercle.
    g.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    const battement = reduced ? 0 : Math.sin(t * 10 + phase) * 0.6;
    if (aileG.current) aileG.current.rotation.x = battement;
    if (aileD.current) aileD.current.rotation.x = -battement;
  });
  return (
    <group ref={corps}>
      <mesh geometry={GEO.sphere} material={plume} scale={[0.5, 0.13, 0.13]} />
      <group ref={aileG} position={[0, 0, 0.04]}>
        <mesh geometry={GEO.sphere} material={plume} position={[0, 0, 0.2]} scale={[0.15, 0.02, 0.32]} />
      </group>
      <group ref={aileD} position={[0, 0, -0.04]}>
        <mesh geometry={GEO.sphere} material={plume} position={[0, 0, -0.2]} scale={[0.15, 0.02, 0.32]} />
      </group>
    </group>
  );
}

/** Quelques oiseaux qui tournent au-dessus du lieu. */
function Oiseaux({ reduced }: { reduced: boolean }) {
  const oiseaux = useMemo(() => {
    const r = hasard(601);
    return Array.from({ length: 7 }, (_, i) => ({
      angle0: (i / 7) * Math.PI * 2,
      rayon: 14 + r() * 8,
      vitesse: 0.12 + r() * 0.1,
      hauteur: 7 + r() * 4,
      phase: r() * 6,
    }));
  }, []);
  return (
    <group>
      {oiseaux.map((o, i) => (
        <Oiseau key={i} {...o} reduced={reduced} />
      ))}
    </group>
  );
}

/** Un poisson qui saute hors de la mer, en arc, puis replonge. */
function Poisson({
  x,
  z,
  dir,
  phase,
  couleur,
  reduced,
}: {
  x: number;
  z: number;
  dir: number;
  phase: number;
  couleur: string;
  reduced: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const corps = useMemo(() => new THREE.MeshToonMaterial({ color: couleur }), [couleur]);
  useEffect(() => () => corps.dispose(), [corps]);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const cycle = 4.2;
    const duree = 1.1;
    const t = (state.clock.elapsedTime + phase) % cycle;
    const saute = !reduced && t < duree;
    g.visible = saute;
    if (saute) g.position.y = SURFACE_MER + Math.sin(Math.PI * (t / duree)) * 1.1;
  });
  return (
    <group ref={ref} position={[x, SURFACE_MER, z]} rotation={[0, dir, 0]} visible={false}>
      <mesh geometry={GEO.sphere} material={corps} scale={[0.45, 0.16, 0.16]} />
      <mesh
        geometry={GEO.cone}
        material={corps}
        position={[-0.42, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[0.14, 0.22, 0.14]}
      />
    </group>
  );
}

/** Des poissons qui sautent tout autour du plateau, chacun à son rythme. */
function Poissons({ taille, reduced }: { taille: Taille; reduced: boolean }) {
  const pts = useMemo(() => autour(5, taille.largeur, taille.hauteur, 2.4, 19, 701), [taille.largeur, taille.hauteur]);
  const couleurs = ['#ff8c42', '#f4a261', '#3a86ff', '#ffd23f', '#e76f51'];
  return (
    <group>
      {pts.map((p, i) => (
        <Poisson
          key={i}
          x={p.x}
          z={p.z}
          dir={p.aleat * Math.PI * 2}
          phase={i * 0.9}
          couleur={couleurs[i % couleurs.length] ?? '#ff8c42'}
          reduced={reduced}
        />
      ))}
    </group>
  );
}

/** Des lucioles qui dérivent doucement autour du plateau. */
function Lucioles({ taille, reduced }: { taille: Taille; reduced: boolean }) {
  const points = useMemo(
    () => autour(20, taille.largeur, taille.hauteur, 1.5, 16, 401),
    [taille.largeur, taille.hauteur],
  );
  const groupes = useRef<Array<THREE.Group | null>>([]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff3a0' }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    points.forEach((p, i) => {
      const g = groupes.current[i];
      if (!g) return;
      g.position.set(
        p.x + Math.sin(t * 0.5 + i) * 0.6,
        1.5 + p.aleat * 4 + Math.sin(t * 0.9 + i * 1.7) * 0.5,
        p.z + Math.cos(t * 0.4 + i) * 0.6,
      );
    });
  });
  return (
    <group>
      {points.map((p, i) => (
        <group
          key={i}
          ref={(g) => {
            groupes.current[i] = g;
          }}
          position={[p.x, 1.5 + p.aleat * 4, p.z]}
        >
          <mesh geometry={GEO.sphere} material={mat} scale={0.07} />
        </group>
      ))}
    </group>
  );
}

function Gymnase({ taille }: { taille: Taille }) {
  const sol = useMemo(() => {
    const t = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#1a2336';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(140,180,255,0.22)';
      ctx.lineWidth = 5;
      for (let i = 0; i <= w; i += 128) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }
      for (let j = 0; j <= h; j += 128) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(w, j);
        ctx.stroke();
      }
    });
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(16, 16);
    return t;
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: sol, roughness: 1 }), [sol]);
  const tapis = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: '#ff4d6d', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.9 }),
    ],
    [],
  );
  useEffect(
    () => () => {
      sol.dispose();
      mat.dispose();
      tapis.forEach((t) => t.dispose());
    },
    [sol, mat, tapis],
  );
  const bord = taille.largeur / 2 + 3.2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} material={mat}>
        <planeGeometry args={[140, 140]} />
      </mesh>
      {/* Deux tapis de réception, de part et d’autre du mur de prises. */}
      <Forme
        geometrie={GEO.bloc}
        materiau={tapis[0] ?? mat}
        contour={0.03}
        position={[-bord, -2.8, 0]}
        scale={[2.6, 0.4, 5]}
      />
      <Forme
        geometrie={GEO.bloc}
        materiau={tapis[1] ?? mat}
        contour={0.03}
        position={[bord, -2.8, 0]}
        scale={[2.6, 0.4, 5]}
      />
    </group>
  );
}

function Plateforme({ taille, reduced }: { taille: Taille; reduced: boolean }) {
  return (
    <group>
      {/* Le vide, très bas : le plateau flotte au-dessus d’une mer turquoise. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#1d6470" roughness={1} />
      </mesh>
      <Bulles taille={taille} reduced={reduced} />
      <IlotsFlottants taille={taille} />
    </group>
  );
}

/**
 * Tous les murs du plateau d’un même lieu, dessinés en un seul appel : un buisson, un iceberg ou un pilier
 * par case, avec son contour. Un plateau de 60 murs reste ainsi léger, même sur un téléviseur modeste.
 */
export function Murs({
  theme,
  positions,
  materiau,
}: {
  theme: ThemePlateau;
  positions: Array<[number, number]>;
  materiau: THREE.Material;
}) {
  const formes = useMemo(() => formesDesMurs(theme), [theme]);
  const coque = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1d1426', side: THREE.BackSide }), []);
  const groupes = useMemo(
    () =>
      formes.map((f) => {
        const fond = new THREE.InstancedMesh(f.geometrie, f.materiau ?? materiau, positions.length * f.copies);
        const contour = new THREE.InstancedMesh(f.geometrie, coque, positions.length * f.copies);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        let k = 0;
        for (const [x, z] of positions) {
          for (const d of f.decalages) {
            const p = new THREE.Vector3(x + d.x, d.y, z + d.z);
            const e = new THREE.Vector3(d.sx, d.sy, d.sz);
            m.compose(p, q, e);
            fond.setMatrixAt(k, m);
            const eContour = e.clone().multiplyScalar(1 + f.contour);
            m.compose(p, q, eContour);
            contour.setMatrixAt(k, m);
            k++;
          }
        }
        fond.castShadow = true;
        fond.receiveShadow = true;
        fond.instanceMatrix.needsUpdate = true;
        contour.instanceMatrix.needsUpdate = true;
        return { fond, contour };
      }),
    [formes, positions, materiau, coque],
  );
  useEffect(
    () => () => {
      for (const g of groupes) {
        g.fond.dispose();
        g.contour.dispose();
      }
      coque.dispose();
    },
    [groupes, coque],
  );
  return (
    <group>
      {groupes.map((g, i) => (
        <group key={i}>
          <primitive object={g.contour} />
          <primitive object={g.fond} />
        </group>
      ))}
    </group>
  );
}

/** Les formes qui composent un mur, selon le lieu : chacune a ses décalages et son propre matériau. */
function formesDesMurs(theme: ThemePlateau): Array<{
  geometrie: THREE.BufferGeometry;
  materiau?: THREE.Material;
  copies: number;
  contour: number;
  decalages: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }>;
}> {
  if (theme.ambiance === 'ile') {
    // La jungle : des buissons en grappes, sans bloc.
    return [
      {
        geometrie: GEO.sphere,
        copies: 2,
        contour: 0.045,
        decalages: [
          { x: 0, y: 0.5, z: 0, sx: 0.5, sy: 0.5, sz: 0.5 },
          { x: 0.2, y: 0.36, z: 0.15, sx: 0.3, sy: 0.3, sz: 0.3 },
        ],
      },
    ];
  }
  if (theme.murs === 'grillage') {
    // Des poteaux blancs tous les cases du contour ; la toile est posée par-dessus (voir Grillage).
    return [
      {
        geometrie: GEO.cube,
        materiau: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 }),
        copies: 1,
        contour: 0.05,
        decalages: [{ x: 0, y: 0.45, z: 0, sx: 0.07, sy: 0.9, sz: 0.07 }],
      },
    ];
  }
  if (theme.ambiance === 'pelouse') {
    return [
      {
        geometrie: GEO.bloc,
        copies: 1,
        contour: 0.045,
        decalages: [{ x: 0, y: 0.45, z: 0, sx: 0.9, sy: 0.9, sz: 0.9 }],
      },
    ];
  }
  if (theme.ambiance === 'mer') {
    return [
      {
        geometrie: GEO.cylindre,
        copies: 1,
        contour: 0.04,
        decalages: [{ x: 0, y: 0.36, z: 0, sx: 0.5, sy: 0.72, sz: 0.5 }],
      },
      {
        geometrie: GEO.cylindre,
        materiau: new THREE.MeshToonMaterial({ color: '#ffffff' }),
        copies: 1,
        contour: 0.03,
        decalages: [{ x: 0, y: 0.8, z: 0, sx: 0.3, sy: 0.16, sz: 0.3 }],
      },
    ];
  }
  return [
    {
      geometrie: GEO.bloc,
      copies: 1,
      contour: 0.04,
      decalages: [{ x: 0, y: HAUT_MUR / 2, z: 0, sx: 0.9, sy: HAUT_MUR, sz: 0.9 }],
    },
    {
      geometrie: GEO.dome,
      materiau: new THREE.MeshToonMaterial({ color: '#d9d2c3' }),
      copies: 1,
      contour: 0.03,
      decalages: [{ x: 0, y: HAUT_MUR, z: 0, sx: 0.4, sy: 0.16, sz: 0.4 }],
    },
  ];
}
