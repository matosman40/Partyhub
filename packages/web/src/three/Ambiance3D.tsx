import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemePlateau } from '@partyhub/shared';
import { Forme, GEO } from './Forme';
import { hasard, texFeuillage, texGlace, texHerbe, texPierre } from './materiaux';

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
  if (ambiance === 'plateforme') return { epaisseur: 1.5, flanc: '#23262f', rebord: '#3c4150' };
  return { epaisseur: 0.32, flanc: '#7a4f2e', rebord: '#5fae45' };
}

/** Les couleurs du ciel (haut) et de l’horizon (bas) : l’horizon sert aussi de couleur de brume. */
export function cieDe(ambiance: ThemePlateau['ambiance']) {
  if (ambiance === 'mer') return { haut: '#1f7fcf', bas: '#b9e8ff' };
  if (ambiance === 'plateforme') return { haut: '#0c0a18', bas: '#3a2a50' };
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
      {theme.ambiance === 'plateforme' && <Plateforme theme={theme} taille={taille} />}
      {theme.ambiance === 'pelouse' && <Pelouse theme={theme} taille={taille} />}
      {theme.ambiance !== 'plateforme' && <Nuages />}
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

function Plateforme({ theme, taille }: { theme: ThemePlateau; taille: Taille }) {
  const piliers = useMemo(
    () => autour(10, taille.largeur, taille.hauteur, 2.5, 18, 37),
    [taille.largeur, taille.hauteur],
  );
  const roches = useMemo(() => autour(7, taille.largeur, taille.hauteur, 4, 30, 91), [taille.largeur, taille.hauteur]);
  const pierre = useMemo(
    () => new THREE.MeshStandardMaterial({ map: texPierre(theme.mur.couleur, theme.mur.joint, 47), roughness: 0.9 }),
    [theme.mur.couleur, theme.mur.joint],
  );
  const roche = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 1 }), []);
  const lueur = useMemo(
    () => new THREE.MeshStandardMaterial({ color: theme.ballon, emissive: theme.ballon, emissiveIntensity: 2.2 }),
    [theme.ballon],
  );
  useEffect(
    () => () => {
      pierre.map?.dispose();
      pierre.dispose();
      roche.dispose();
      lueur.dispose();
    },
    [pierre, roche, lueur],
  );
  return (
    <group>
      {/* Le vide, très bas : la plateforme est suspendue au-dessus. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#262a4a" roughness={1} />
      </mesh>
      {roches.map((p, i) => (
        <Forme
          key={`r${i}`}
          geometrie={GEO.rocher}
          materiau={roche}
          contour={0.03}
          position={[p.x, -4 - p.aleat * 3, p.z]}
          rotation={[p.aleat, p.aleat * 2, 0]}
          scale={2 + p.aleat * 2.5}
        />
      ))}
      {piliers.map((p, i) => {
        const hauteur = 4 + p.aleat * 5;
        return (
          <group key={`p${i}`} position={[p.x, 0, p.z]}>
            <Forme
              geometrie={GEO.cylindre}
              materiau={pierre}
              contour={0.035}
              position={[0, hauteur / 2 - 6, 0]}
              scale={[0.65, hauteur, 0.65]}
            />
            <mesh position={[0, hauteur - 5.8, 0]} geometry={GEO.sphere} material={lueur} scale={0.22} />
          </group>
        );
      })}
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
  if (theme.ambiance === 'pelouse') {
    return [
      {
        geometrie: GEO.sphere,
        copies: 2,
        contour: 0.045,
        decalages: [
          { x: 0, y: 0.5, z: 0, sx: 0.46, sy: 0.46, sz: 0.46 },
          { x: 0.2, y: 0.36, z: 0.14, sx: 0.28, sy: 0.28, sz: 0.28 },
        ],
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
      geometrie: GEO.cylindre,
      copies: 1,
      contour: 0.035,
      decalages: [{ x: 0, y: HAUT_MUR / 2, z: 0, sx: 0.44, sy: HAUT_MUR, sz: 0.44 }],
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
