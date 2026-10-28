import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemePlateau } from '@partyhub/shared';

/**
 * Le lieu autour du plateau et la forme de ses murs, selon le thème : une pelouse avec des buissons et
 * des arbres, une mer avec une banquise (icebergs sur les bords, eau qui ondule), ou une plateforme de
 * pierre au-dessus du vide (piliers). Rien n’est chargé : tout est dessiné avec des formes simples.
 */

/** Hauteur des murs, en unités du plateau. */
export const HAUT_MUR = 0.95;

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
  if (theme.ambiance === 'mer') return <Mer theme={theme} taille={taille} reduced={reduced} />;
  if (theme.ambiance === 'plateforme') return <Plateforme theme={theme} taille={taille} />;
  return <Pelouse theme={theme} taille={taille} />;
}

function Pelouse({ theme, taille }: { theme: ThemePlateau; taille: Taille }) {
  const arbres = useMemo(
    () => autour(16, { largeur: taille.largeur, hauteur: taille.hauteur }, 2.5, 17, 11),
    [taille.largeur, taille.hauteur],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.24, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color={theme.sol} roughness={1} />
      </mesh>
      {arbres.map((p, i) => (
        <Arbre key={i} x={p.x} z={p.z} taille={0.8 + p.aleat * 0.6} feuillage={theme.mur.couleur} />
      ))}
    </group>
  );
}

function Arbre({ x, z, taille, feuillage }: { x: number; z: number; taille: number; feuillage: string }) {
  return (
    <group position={[x, 0, z]} scale={taille}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1, 8]} />
        <meshStandardMaterial color="#6b4a2b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.45, 0]} castShadow>
        <sphereGeometry args={[0.8, 16, 12]} />
        <meshStandardMaterial color={feuillage} roughness={0.9} />
      </mesh>
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
    if (eau.current && !reduced) eau.current.position.y = -0.36 + Math.sin(state.clock.elapsedTime * 0.9) * 0.02;
  });
  return (
    <group>
      <mesh ref={eau} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color={theme.eau} roughness={0.3} metalness={0.1} />
      </mesh>
      {banquise.map((p, i) => (
        <mesh key={i} position={[p.x, -0.2, p.z]} rotation={[0, p.aleat * 3, 0]} receiveShadow>
          <cylinderGeometry args={[0.9 + p.aleat * 0.9, 1.1 + p.aleat * 0.9, 0.16, 9]} />
          <meshStandardMaterial color={theme.ciel} roughness={0.6} />
        </mesh>
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
        <meshStandardMaterial color="#05060a" roughness={1} />
      </mesh>
      {piliers.map((p, i) => {
        const hauteur = 4 + p.aleat * 5;
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, hauteur / 2 - 6, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.6, 0.7, hauteur, 10]} />
              <meshStandardMaterial color={theme.mur.couleur} roughness={0.9} />
            </mesh>
            <mesh position={[0, hauteur - 5.8, 0]}>
              <sphereGeometry args={[0.22, 10, 8]} />
              <meshStandardMaterial color={theme.ballon} emissive={theme.ballon} emissiveIntensity={1.4} />
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
          <meshStandardMaterial color={theme.mur.joint} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.46, 16, 12]} />
          <meshStandardMaterial map={texture} roughness={0.9} />
        </mesh>
        <mesh position={[0.2, 0.36, 0.14]} castShadow>
          <sphereGeometry args={[0.28, 12, 10]} />
          <meshStandardMaterial map={texture} roughness={0.9} />
        </mesh>
      </group>
    );
  }
  if (theme.ambiance === 'mer') {
    return (
      <mesh position={[x, 0.36, z]} castShadow receiveShadow>
        <cylinderGeometry args={[0.44, 0.54, 0.72, 6]} />
        <meshStandardMaterial color={theme.mur.couleur} roughness={0.3} metalness={0.05} />
      </mesh>
    );
  }
  return (
    <mesh position={[x, HAUT_MUR / 2, z]} castShadow receiveShadow>
      <cylinderGeometry args={[0.42, 0.46, HAUT_MUR, 10]} />
      <meshStandardMaterial map={texture} roughness={0.9} />
    </mesh>
  );
}
