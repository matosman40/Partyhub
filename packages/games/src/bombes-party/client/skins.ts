import { resolveLook, type CharacterPackInfo, type CharacterSpec } from '@partyhub/shared';
import { packAtlasUrl, PACK_FULL_POSE } from '../../client/character-pack-figure.js';

/**
 * Personnages importés, dessinés sur le plateau. Un personnage importé a une planche « poses » :
 * on prend sa case « repos » (corps entier, face au joueur) et on la dessine à la place du sprite
 * peint en code. Les autres joueurs gardent leur sprite.
 */

/** Une case de planche, prête pour `ctx.drawImage`. */
export interface PackSkin {
  image: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Une image par planche, gardée entre deux images du jeu. Le canvas se redessine à chaque image : rien à relancer. */
const atlases = new Map<string, HTMLImageElement>();

function atlasImage(url: string): HTMLImageElement {
  let img = atlases.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    atlases.set(url, img);
  }
  return img;
}

/** Case « repos » du personnage, ou null : pas de pack, pack non chargé, look sans planche « poses ». */
export function packSkinFor(spec: CharacterSpec | null | undefined, packs: CharacterPackInfo[]): PackSkin | null {
  if (!spec?.pack) return null;
  const pack = packs.find((p) => p.id === spec.pack);
  if (!pack) return null;
  const look = resolveLook(pack, spec.look);
  if (!look) return null;
  const atlas = look.atlases.poses;
  if (!atlas) return null;
  const frame = atlas.images.find((img) => img.name === PACK_FULL_POSE.idle) ?? atlas.images[0];
  if (!frame) return null;
  const image = atlasImage(packAtlasUrl(pack.id, look.id, 'poses'));
  return { image, sx: frame.x, sy: frame.y, sw: frame.w, sh: frame.h };
}

/** Vrai quand la planche est chargée et peut être dessinée. */
export function skinReady(skin: PackSkin): boolean {
  return skin.image.complete && skin.image.naturalWidth > 0;
}
