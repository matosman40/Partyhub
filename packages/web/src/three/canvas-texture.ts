import * as THREE from 'three';

/**
 * Texture dessinée sur un canevas : sol, briques, caisses. Pas d’image externe à charger, donc pas de
 * page qui attend un fichier. La texture garde les contours nets quand on la regarde de biais.
 */
export function canvasTexture(
  largeur: number,
  hauteur: number,
  dessin: (ctx: CanvasRenderingContext2D, largeur: number, hauteur: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  if (ctx) dessin(ctx, largeur, hauteur);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
