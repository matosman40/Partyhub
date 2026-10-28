import * as THREE from 'three';
import { canvasTexture } from './canvas-texture';

/**
 * Matières dessinées à la main sur un canevas : herbe, bois, pierre, feuillage, glace. Chaque matière a
 * du bruit (aucun motif répété à l’identique), comme dans un jeu de plateau soigné. Rien n’est chargé.
 */

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

/** Éclaircit (`t` > 0, vers le blanc) ou assombrit (`t` < 0, vers le noir) une couleur hexadécimale. */
export function nuancer(hex: string, t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (v: number) => {
    const cible = t >= 0 ? 255 : 0;
    return Math.round(v + (cible - v) * Math.min(1, Math.abs(t)));
  };
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Une texture qui se répète sans couture (herbe, pierre). */
function repete(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Touffes d’herbe : des traits clairs et sombres, et des taches de couleur. Posées par-dessus un fond. */
export function touffesHerbe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  couleur: string,
  graine: number,
  densite: number,
) {
  const r = hasard(graine);
  for (let i = 0; i < w * h * densite; i++) {
    const x = r() * w;
    const y = r() * h;
    const hauteur = 4 + r() * 7;
    const claire = r() < 0.5;
    ctx.strokeStyle = claire ? nuancer(couleur, 0.28 + r() * 0.2) : nuancer(couleur, -(0.25 + r() * 0.2));
    ctx.lineWidth = 1.2 + r() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 3, y - hauteur * 0.6, x + (r() - 0.5) * 5, y - hauteur);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 12 + r() * 28, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Pelouse qui se répète : fond vert nuancé, touffes, quelques fleurs minuscules. */
export function texHerbe(couleur: string, graine: number): THREE.CanvasTexture {
  return repete(
    canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = couleur;
      ctx.fillRect(0, 0, w, h);
      touffesHerbe(ctx, w, h, couleur, graine, 0.06);
      const r = hasard(graine + 1);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = ['#fff7a1', '#ffffff', '#ffb3c7'][Math.floor(r() * 3)] ?? '#ffffff';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  );
}

/** Planches de bois peintes, avec des nœuds et des clous : pour les caisses. */
export function texBois(couleur: string, trait: string, graine: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const r = hasard(graine);
    ctx.fillStyle = couleur;
    ctx.fillRect(0, 0, w, h);
    for (let p = 0; p < 4; p++) {
      const y0 = (p * h) / 4;
      ctx.fillStyle = nuancer(couleur, (r() - 0.5) * 0.12);
      ctx.fillRect(0, y0, w, h / 4);
      // Fibres du bois : traits fins, légèrement ondulés.
      for (let f = 0; f < 10; f++) {
        ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.14)';
        ctx.lineWidth = 1 + r() * 1.5;
        ctx.beginPath();
        const y = y0 + r() * (h / 4);
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.6, y - (r() - 0.5) * 8, w, y + (r() - 0.5) * 6);
        ctx.stroke();
      }
      // Joint entre deux planches.
      ctx.fillStyle = trait;
      ctx.fillRect(0, y0, w, 5);
    }
    // Clous aux quatre coins.
    ctx.fillStyle = nuancer(trait, 0.3);
    for (const [x, y] of [
      [22, 22],
      [w - 22, 22],
      [22, h - 22],
      [w - 22, h - 22],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bordure et croix de renfort.
    ctx.strokeStyle = trait;
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(14, 14);
    ctx.lineTo(w - 14, h - 14);
    ctx.moveTo(w - 14, 14);
    ctx.lineTo(14, h - 14);
    ctx.stroke();
  });
}

/** Pierre de taille : blocs décalés, chacun un peu plus clair ou plus sombre, avec des fissures. */
export function texPierre(couleur: string, joint: string, graine: number): THREE.CanvasTexture {
  return repete(
    canvasTexture(256, 256, (ctx, w, h) => {
      const r = hasard(graine);
      ctx.fillStyle = joint;
      ctx.fillRect(0, 0, w, h);
      const rangees = 4;
      const hb = h / rangees;
      for (let row = 0; row < rangees; row++) {
        const decal = row % 2 === 0 ? 0 : w / 4;
        for (let c = -1; c <= 2; c++) {
          const x = decal + (c * w) / 2;
          ctx.fillStyle = nuancer(couleur, (r() - 0.5) * 0.22);
          ctx.fillRect(x + 3, row * hb + 3, w / 2 - 6, hb - 6);
        }
      }
      // Grain de la pierre et fissures.
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
        ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const x = r() * w;
        const y = r() * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 40, y + 10 + r() * 20);
        ctx.stroke();
      }
    }),
  );
}

/** Feuillage : des amas de feuilles, clairs en haut, sombres en bas. */
export function texFeuillage(couleur: string, graine: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const r = hasard(graine);
    ctx.fillStyle = nuancer(couleur, -0.35);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = r() * w;
      const y = r() * h;
      const rayon = 9 + r() * 16;
      ctx.fillStyle = nuancer(couleur, (r() - 0.4) * 0.45);
      ctx.beginPath();
      ctx.arc(x, y, rayon, 0, Math.PI * 2);
      ctx.fill();
      // Reflet clair en haut à gauche de chaque amas.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(x - rayon * 0.3, y - rayon * 0.35, rayon * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Glace : fond clair, fissures blanches et éclats. */
export function texGlace(couleur: string, graine: number): THREE.CanvasTexture {
  return repete(
    canvasTexture(256, 256, (ctx, w, h) => {
      const r = hasard(graine);
      ctx.fillStyle = couleur;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 6 + r() * 18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let x = r() * w;
        let y = r() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += (r() - 0.5) * 40;
          y += (r() - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
    }),
  );
}

/** Un mur d’escalade : de la roche grise, avec des prises colorées bordées d’ombre. */
export function texPrises(couleur: string, graine: number): THREE.CanvasTexture {
  return repete(
    canvasTexture(256, 256, (ctx, w, h) => {
      const r = hasard(graine);
      ctx.fillStyle = couleur;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)';
        ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4);
      }
      const couleurs = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316'];
      for (let i = 0; i < 24; i++) {
        const x = r() * w;
        const y = r() * h;
        const rayon = 7 + r() * 6;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(x + 2, y + 3, rayon, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = couleurs[Math.floor(r() * couleurs.length)] ?? '#ef4444';
        ctx.beginPath();
        ctx.arc(x, y, rayon, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(x - rayon * 0.3, y - rayon * 0.35, rayon * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  );
}
