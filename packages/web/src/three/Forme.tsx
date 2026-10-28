import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Une forme avec son contour sombre, comme dans un jeu de plateau dessiné : une coque noire, légèrement
 * plus grande, vue par l’intérieur. Les formes sont centrées sur leur origine, ce qui rend le contour
 * uniforme.
 */
export interface FormeProps {
  geometrie: THREE.BufferGeometry;
  materiau: THREE.Material;
  /** Épaisseur du contour, en fraction de la taille (0 : pas de contour). */
  contour?: number;
  couleurContour?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  /** Projette et reçoit les ombres. */
  ombre?: boolean;
}

export function Forme({
  geometrie,
  materiau,
  contour = 0.04,
  couleurContour = '#1d1426',
  position,
  rotation,
  scale,
  ombre = true,
}: FormeProps) {
  const coque = useMemo(
    () => new THREE.MeshBasicMaterial({ color: couleurContour, side: THREE.BackSide }),
    [couleurContour],
  );
  useEffect(() => () => coque.dispose(), [coque]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometrie} material={materiau} castShadow={ombre} receiveShadow={ombre} />
      {contour > 0 && <mesh geometry={geometrie} material={coque} scale={1 + contour} />}
    </group>
  );
}

/** Géométries partagées par tout le décor : une seule fois en mémoire, mises à l’échelle à l’usage. */
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  dome: new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  cylindre: new THREE.CylinderGeometry(1, 1, 1, 14),
  /** Un disque lisse, pour que l’arène ronde ne montre pas de facettes. */
  disque: new THREE.CylinderGeometry(1, 1, 1, 56),
  cone: new THREE.ConeGeometry(1, 1, 10),
  cube: new THREE.BoxGeometry(1, 1, 1),
  rocher: new THREE.DodecahedronGeometry(1, 0),
  /** Un bloc aux arêtes arrondies, comme les murs de Bombes party. */
  bloc: new RoundedBoxGeometry(1, 1, 1, 4, 0.14),
};
