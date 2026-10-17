import * as THREE from 'three';
import type { AvatarData, PlayerPub, PromoteurPub, TilePub } from '@partyhub/games/client';
import { GROUP_COLOR, GROUP_LABEL } from '@partyhub/games/client';

/**
 * Textures dessinées sur canvas : cases, faces des dés, pions et panneau central.
 * Tout est dessiné ici (aucune image externe), en haute définition pour rester net de près.
 */

export const FONT = '"Archivo Variable", Archivo, system-ui, sans-serif';
const INK = '#f7f4ff';
const MUTED = '#b9b2d8';
const PANEL = '#17112e';
const GOLD = '#ffd166';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return [c, ctx];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Teinte stable dérivée du pseudo, identique à celle des avatars en 2D. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Texte découpé en lignes qui tiennent dans la largeur donnée (au plus `maxLines`). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  // Seules les espaces ordinaires coupent une ligne : les espaces insécables (« 200 € ») restent ensemble.
  const words = text.split(/[ \t\n]+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''}…`;
    return kept;
  }
  return lines;
}

/** Case du plateau : couleur de rue, nom, prix, propriétaire et maisons. */
export function tileTexture(tile: TilePub, owner: PlayerPub | undefined, pending = false): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const isStreet = tile.kind === 'street';

  ctx.fillStyle = isStreet ? '#1f1845' : '#140f2c';
  roundRect(ctx, 0, 0, S, S, 56);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 6;
  ctx.stroke();

  if (tile.group) {
    ctx.fillStyle = GROUP_COLOR[tile.group];
    roundRect(ctx, 0, 0, S, 96, 56);
    ctx.fill();
    ctx.fillRect(0, 60, S, 36);
  }

  ctx.fillStyle = INK;
  // Texte gros : la case doit rester lisible depuis le canapé.
  ctx.font = `700 68px ${FONT}`;
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, tile.name, S - 72, 2);
  lines.forEach((line, i) => ctx.fillText(line, 36, (tile.group ? 128 : 40) + i * 76));

  if (tile.price !== undefined) {
    ctx.fillStyle = GOLD;
    ctx.font = `700 64px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${tile.price} €`, 36, S - 52);
  }

  if (owner) {
    const cx = S - 86;
    const cy = S - 96;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${hueOf(owner.name)} 85% 62%)`;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#0d0a1f';
    ctx.font = `800 62px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(owner.name.charAt(0).toUpperCase(), cx, cy + 4);
    ctx.textAlign = 'left';
  }

  const houses = tile.houses;
  for (let i = 0; i < houses; i++) {
    ctx.fillStyle = '#b6ff5c';
    roundRect(ctx, 36 + i * 56, S - 170, 44, 44, 9);
    ctx.fill();
  }

  if (pending) {
    // Case mise en vente : liseré doré bien visible depuis la table.
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 18;
    roundRect(ctx, 9, 9, S - 18, S - 18, 48);
    ctx.stroke();
  }

  return texture(c);
}

/** Face d’un dé : fond clair et points noirs, disposition classique. */
export function dieFaceTexture(value: number): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#fbfaff';
  roundRect(ctx, 0, 0, S, S, 46);
  ctx.fill();
  ctx.fillStyle = '#17112e';
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.27, 0.27],
      [0.73, 0.73],
    ],
    3: [
      [0.27, 0.27],
      [0.5, 0.5],
      [0.73, 0.73],
    ],
    4: [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.27, 0.73],
      [0.73, 0.73],
    ],
    5: [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.5, 0.5],
      [0.27, 0.73],
      [0.73, 0.73],
    ],
    6: [
      [0.27, 0.25],
      [0.73, 0.25],
      [0.27, 0.5],
      [0.73, 0.5],
      [0.27, 0.75],
      [0.73, 0.75],
    ],
  };
  for (const [x, y] of pips[value] ?? []) {
    ctx.beginPath();
    ctx.arc(x * S, y * S, S * 0.085, 0, Math.PI * 2);
    ctx.fill();
  }
  return texture(c);
}

/** Pion : photo recadrée en cercle si elle est autorisée, sinon l’emoji sur sa teinte. */
export function avatarTexture(avatar: AvatarData, name: string): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  const t = texture(c);

  const drawEmoji = () => {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, `hsl(${avatar.hue} 85% 66%)`);
    g.addColorStop(1, `hsl(${(avatar.hue + 40) % 360} 80% 46%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.font = `${S * 0.56}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(avatar.emoji || name.charAt(0), S / 2, S / 2 + 8);
    t.needsUpdate = true;
  };
  drawEmoji();

  if (avatar.imageUrl) {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
      ctx.clip();
      // Recadrage carré centré : la photo remplit le disque.
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
      ctx.restore();
      t.needsUpdate = true;
    };
    img.onerror = () => undefined;
    img.src = avatar.imageUrl;
  }
  return t;
}

/** Panneau central : tour, joueur courant, dernier événement et classement. */
export function centreTexture(pub: PromoteurPub): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = PANEL;
  roundRect(ctx, 0, 0, S, S, 90);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = `600 52px ${FONT}`;
  ctx.fillText(`TOUR ${pub.round} / ${pub.rounds}`, S / 2, 150);

  ctx.fillStyle = INK;
  ctx.font = `800 110px ${FONT}`;
  const current = pub.currentName ?? '—';
  ctx.fillText(current, S / 2, 290, S - 120);

  ctx.font = `500 46px ${FONT}`;
  ctx.fillStyle = MUTED;
  const eventLines = wrap(ctx, pub.lastEvent.replace(/ €/g, '\u00a0€'), S - 200, 3);
  eventLines.forEach((line, i) => ctx.fillText(line, S / 2, 380 + i * 62));

  // Classement : les quatre premières fortunes.
  ctx.textAlign = 'left';
  pub.ranking.slice(0, 4).forEach((r, i) => {
    const y = 640 + i * 90;
    ctx.fillStyle = i === 0 ? GOLD : MUTED;
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText(String(r.rank), 150, y);
    ctx.fillStyle = INK;
    ctx.font = `600 52px ${FONT}`;
    ctx.fillText(r.name, 230, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = GOLD;
    ctx.font = `700 52px ${FONT}`;
    ctx.fillText(`${r.points.toLocaleString('fr-FR')} €`, S - 150, y);
    ctx.textAlign = 'left';
  });

  // Légende des couleurs de rue.
  ctx.font = `600 34px ${FONT}`;
  let x = 150;
  for (const [group, label] of Object.entries(GROUP_LABEL)) {
    ctx.fillStyle = GROUP_COLOR[group as keyof typeof GROUP_COLOR];
    ctx.beginPath();
    ctx.arc(x + 14, 948, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.fillText(label, x + 40, 960);
    x += 40 + ctx.measureText(label).width + 50;
  }

  return texture(c);
}
