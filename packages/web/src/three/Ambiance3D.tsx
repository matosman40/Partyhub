import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemePlateau } from '@partyhub/shared';

/**
 * Le lieu autour du plateau, dans le style des jeux de plateau de fête : couleurs franches, formes
 * rondes, ombres nettes. Une pelouse avec buissons, fleurs, champignons et arbres ; une mer avec une
 * banquise, des icebergs et une eau qui ondule ; une plateforme de pierre au-dessus du vide. Rien n’est
 * chargé : tout est dessiné avec des formes simples.
 */

/** Hauteur des murs, en unités du plateau. */
export const HAUT_MUR = 0.95;

/** Le bloc sous le plateau : son épaisseur, la couleur de ses flancs et celle de son rebord. */
export function socleDe(ambiance: ThemePlateau['ambiance']) {
  if (ambiance === 'mer') return { epaisseur: 0.5, flanc: '#2f77a8', rebord: '#eaf9ff' };
  if (ambiance === 'plateforme') return { epaisseur: 1.5, flanc: '#23262f', rebord: '#3c4150' };
  return { epaisseur: 0.32, flanc: '#7a4f2e', rebord: '#5fae45' };
}

/** Générateur pseudo-aléatoire à graine : le décor est le même à chaque affichage. */
export function hasard(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Taille {
  largeur: number;
  hauteur: number;
}

/** Des points tirés au hasard autour du plateau, jamais sur lui (le carré du plateau est exclu). */
function autour(n: number, taille: Taille, marge: number, rayon: number, graine: number) {
  const r = hasard(graine);
  const demiL = taille.largeur / 2 + marge;
  const demiH = taille.hauteur / 2 + marge;
  const points: Array<{ x: number; z: number; aleat: number }> = [];
  for (let essais = 0; points.length < n && essais < n * 60; essais++) {
    const x = (r() * 2 - 1) * rayon;
    const z = (r() * 2 - 1) * rayon;
    if (Math.abs(x) < demiL && Math.abs(z) < demiH) continue;
    points.push({ x, z, aleat: r() });
  }
  return points;
}

/** Le décor qui entoure le plateau. */
export function Environnement({ theme, taille, reduced }: { theme: ThemePlateau; taille: Taille; reduced: boolean }) {
  if (theme.ambiance === 'mer') {
    return (
      <>
        <Mer theme={theme} taille={taille} reduced={reduced} />
        <Nuages />
      </>
    );
  }
  if (theme.ambiance === 'plateforme') return <Plateforme theme={theme} taille={taille} />;
  return (
    <>
      <Pelouse theme={theme} taille={taille} />
      <Nuages />
    </>
  );
}

const COULEURS_FLEURS = ['#ff5d8f', '#ffd23f', '#ffffff', '#b67aff', '#ff9f1c'];

function Pelouse({ theme, taille }: { theme: ThemePlateau; taille: Taille }) {
  const arbres = useMemo(
    () => autour(16, { largeur: taille.largeur, hauteur: taille.hauteur }, 2.5, 17, 11),
    [taille.largeur, taille.hauteur],
  );
  const fleurs = useMemo(
    () =>
      autour(
        40,
        { largeur: taille.largeur, hauteur: taille.hauteur },
        0.7,
        Math.max(taille.largeur, taille.hauteur) / 2 + 5,
        53,
      ),
    [taille.largeur, taille.hauteur],
  );
  const champignons = useMemo(
    () =>
      autour(
        8,
        { largeur: taille.largeur, hauteur: taille.hauteur },
        0.8,
        Math.max(taille.largeur, taille.hauteur) / 2 + 4,
        61,
      ),
    [taille.largeur, taille.hauteur],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshToonMaterial color={theme.sol} />
      </mesh>
      {arbres.map((p, i) => (
        <Arbre key={`a${i}`} x={p.x} z={p.z} taille={0.8 + p.aleat * 0.6} feuillage={theme.mur.couleur} />
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
        <Champignon key={`c${i}`} x={p.x} z={p.z} taille={0.8 + p.aleat * 0.4} />
      ))}
    </group>
  );
}

function Arbre({ x, z, taille, feuillage }: { x: number; z: number; taille: number; feuillage: string }) {
  return (
    <group position={[x, -0.36, z]} scale={taille}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1, 8]} />
        <meshToonMaterial color="#8a5a33" />
      </mesh>
      <mesh position={[0, 1.45, 0]} castShadow>
        <sphereGeometry args={[0.8, 16, 12]} />
        <meshToonMaterial color={feuillage} />
      </mesh>
      <mesh position={[0.35, 1.9, 0.2]} castShadow>
        <sphereGeometry args={[0.35, 12, 10]} />
        <meshToonMaterial color={feuillage} />
      </mesh>
    </group>
  );
}

function Fleur({ x, z, couleur }: { x: number; z: number; couleur: string }) {
  return (
    <group position={[x, -0.36, z]}>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.34, 5]} />
        <meshToonMaterial color="#2e7d32" />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshToonMaterial color={couleur} />
      </mesh>
    </group>
  );
}

function Champignon({ x, z, taille }: { x: number; z: number; taille: number }) {
  return (
    <group position={[x, -0.36, z]} scale={taille}>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 0.3, 8]} />
        <meshToonMaterial color="#fff4e0" />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshToonMaterial color="#e5383b" />
      </mesh>
      {[
        [0.12, 0.36, 0.05],
        [-0.1, 0.38, -0.06],
        [0.02, 0.44, 0.1],
      ].map(([px, py, pz], i) => (
        <mesh key={i} position={[px ?? 0, py ?? 0, pz ?? 0]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshToonMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

/** Quelques nuages flottants, derrière et sur les côtés : jamais entre la caméra et le plateau. */
const NUAGES: Array<[number, number, number, number]> = [
  [-16, 8, -14, 1.2],
  [4, 9, -18, 1.5],
  [15, 7, -12, 1.0],
  [-21, 6, 1, 1.1],
  [21, 8, 3, 1.3],
];

function Nuages() {
  return (
    <group>
      {NUAGES.map(([x, y, z, s], i) => (
        <group key={i} position={[x, y, z]} scale={s}>
          {[
            [0, 0, 0, 1],
            [0.9, -0.15, 0.1, 0.75],
            [-0.9, -0.2, -0.05, 0.8],
            [0.3, 0.45, 0, 0.7],
          ].map(([px, py, pz, r], j) => (
            <mesh key={j} position={[px ?? 0, py ?? 0, pz ?? 0]}>
              <sphereGeometry args={[r ?? 1, 12, 10]} />
              <meshToonMaterial color="#ffffff" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Mer({ theme, taille, reduced }: { theme: ThemePlateau; taille: Taille; reduced: boolean }) {
  const eau = useRef<THREE.Mesh>(null);
  const banquise = useMemo(
    () => autour(10, { largeur: taille.largeur, hauteur: taille.hauteur }, 1.5, 16, 23),
    [taille.largeur, taille.hauteur],
  );
  useFrame((state) => {
    // L’eau ondule doucement, sauf si l’utilisateur a demandé moins de mouvement.
    if (eau.current && !reduced) eau.current.position.y = -0.62 + Math.sin(state.clock.elapsedTime * 0.9) * 0.025;
  });
  return (
    <group>
      <mesh ref={eau} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshToonMaterial color={theme.eau} />
      </mesh>
      {banquise.map((p, i) => (
        <group key={i} position={[p.x, -0.5, p.z]} rotation={[0, p.aleat * 3, 0]}>
          <mesh receiveShadow>
            <cylinderGeometry args={[0.9 + p.aleat * 0.9, 1.1 + p.aleat * 0.9, 0.2, 9]} />
            <meshToonMaterial color="#2f77a8" />
          </mesh>
          <mesh position={[0, 0.1, 0]} receiveShadow>
            <cylinderGeometry args={[0.8 + p.aleat * 0.9, 1 + p.aleat * 0.9, 0.06, 9]} />
            <meshToonMaterial color={theme.ciel} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Plateforme({ theme, taille }: { theme: ThemePlateau; taille: Taille }) {
  const piliers = useMemo(
    () => autour(10, { largeur: taille.largeur, hauteur: taille.hauteur }, 2.5, 18, 37),
    [taille.largeur, taille.hauteur],
  );
  return (
    <group>
      {/* Le vide, très bas : la plateforme est suspendue au-dessus. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]}>
        <planeGeometry args={[120, 120]} />
        <meshToonMaterial color="#05060a" />
      </mesh>
      {piliers.map((p, i) => {
        const hauteur = 4 + p.aleat * 5;
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, hauteur / 2 - 6, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.6, 0.7, hauteur, 10]} />
              <meshToonMaterial color={theme.mur.couleur} />
            </mesh>
            <mesh position={[0, hauteur - 5.8, 0]}>
              <sphereGeometry args={[0.22, 10, 8]} />
              <meshToonMaterial color={theme.ballon} emissive={theme.ballon} emissiveIntensity={1.4} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Un mur du plateau, dans la forme du lieu : buisson, iceberg ou pilier de pierre. */
export function MurDecor({
  theme,
  x,
  z,
  texture,
}: {
  theme: ThemePlateau;
  x: number;
  z: number;
  texture: THREE.Texture;
}) {
  if (theme.ambiance === 'pelouse') {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.46, 0.5, 0.28, 10]} />
          <meshToonMaterial color="#7a4f2e" />
        </mesh>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.46, 16, 12]} />
          <meshToonMaterial map={texture} />
        </mesh>
        <mesh position={[0.2, 0.36, 0.14]} castShadow>
          <sphereGeometry args={[0.28, 12, 10]} />
          <meshToonMaterial map={texture} />
        </mesh>
      </group>
    );
  }
  if (theme.ambiance === 'mer') {
    return (
      <group position={[x, 0.36, z]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.44, 0.54, 0.72, 6]} />
          <meshToonMaterial color={theme.mur.couleur} />
        </mesh>
        <mesh position={[0, 0.42, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.4, 0.2, 6]} />
          <meshToonMaterial color="#ffffff" />
        </mesh>
      </group>
    );
  }
  return (
    <mesh position={[x, HAUT_MUR / 2, z]} castShadow receiveShadow>
      <cylinderGeometry args={[0.42, 0.46, HAUT_MUR, 10]} />
      <meshToonMaterial map={texture} />
    </mesh>
  );
}
