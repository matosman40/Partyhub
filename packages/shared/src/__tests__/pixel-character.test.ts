import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_BODY_COLORS,
  CHARACTER_EYE_COLORS,
  CHARACTER_FACIAL_HAIR,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_STYLES,
  CHARACTER_SKIN_TONES,
  PIXEL_CELL,
  PIXEL_FACES,
  PIXEL_PALETTE,
  PIXEL_POSES,
  PIXEL_TRANSPARENT,
  bitmapToRgba,
  characterSchema,
  defaultCharacterFor,
  drawFace,
  drawPose,
  drawWalk,
  mirrorBitmap,
  renderSheet,
  type CharacterSpec,
  type PixelBitmap,
  type PixelDir,
} from '../index.js';

/** Rendeur pixel : palette, grilles, expressions, marche et déterminisme. */

const SPECS: Record<string, CharacterSpec> = {
  blonde: { body: 1, skin: 0, hair: 5, hairColor: 5, accessory: 4, eyeColor: 2 },
  barbe: { body: 4, skin: 4, hair: 1, hairColor: 0, accessory: 0, facialHair: 2, eyeColor: 1 },
  chignon: { body: 7, skin: 2, hair: 4, hairColor: 2, accessory: 3, eyeColor: 3 },
  rose: { body: 6, skin: 1, hair: 2, hairColor: 3, accessory: 6, eyeColor: 2 },
  pointes: { body: 0, skin: 3, hair: 3, hairColor: 4, accessory: 2, facialHair: 1 },
};

const DIRS: PixelDir[] = ['front', 'back', 'side'];
const FRAMES = [0, 1, 2, 3] as const;

function allBitmaps(spec: CharacterSpec): PixelBitmap[] {
  return [
    ...PIXEL_FACES.map((f) => drawFace(spec, f)),
    ...PIXEL_POSES.map((p) => drawPose(spec, p)),
    ...DIRS.flatMap((d) => FRAMES.map((f) => drawWalk(spec, d, f))),
  ];
}

/** Générateur pseudo-aléatoire déterministe (pour tirer des personnages sans dépendre de Math.random). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % max;
  };
}

function randomSpec(next: (n: number) => number): CharacterSpec {
  return {
    body: next(CHARACTER_BODY_COLORS.length),
    skin: next(CHARACTER_SKIN_TONES.length),
    hair: next(CHARACTER_HAIR_STYLES.length),
    hairColor: next(CHARACTER_HAIR_COLORS.length),
    accessory: next(CHARACTER_ACCESSORIES.length),
    facialHair: next(CHARACTER_FACIAL_HAIR.length),
    eyeColor: next(CHARACTER_EYE_COLORS.length),
  };
}

const at = (b: PixelBitmap, x: number, y: number) => b.pixels[y * b.width + x]!;
const opaque = (b: PixelBitmap, x: number, y: number) => at(b, x, y) !== PIXEL_TRANSPARENT;

/** Ligne la plus basse qui contient un pixel opaque. */
function lowestRow(b: PixelBitmap): number {
  for (let y = b.height - 1; y >= 0; y--) for (let x = 0; x < b.width; x++) if (opaque(b, x, y)) return y;
  return -1;
}

/** Pixels opaques au bord de la silhouette (un voisin transparent dans l’image) qui ne sont pas le contour noir. */
function contourHoles(b: PixelBitmap): number {
  let holes = 0;
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (!opaque(b, x, y) || at(b, x, y) === 0) continue;
      const nb: [number, number][] = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= b.width || ny >= b.height) continue;
        if (!opaque(b, nx, ny)) {
          holes++;
          break;
        }
      }
    }
  }
  return holes;
}

function rows(b: PixelBitmap, from: number, to: number): number[] {
  return Array.from(b.pixels.subarray(from * b.width, (to + 1) * b.width));
}

describe('Palette et grille', () => {
  it('la palette compte 16 couleurs distinctes, sans magenta', () => {
    expect(PIXEL_PALETTE).toHaveLength(16);
    expect(new Set(PIXEL_PALETTE.map((c) => c.toUpperCase())).size).toBe(16);
    expect(PIXEL_PALETTE.map((c) => c.toUpperCase())).not.toContain('#FF00FF');
    expect(PIXEL_PALETTE[0]).toBe('#101010');
  });

  it('chaque sprite fait 32 × 32 et n’utilise que des indices de la palette', () => {
    for (const spec of Object.values(SPECS)) {
      for (const b of allBitmaps(spec)) {
        expect([b.width, b.height]).toEqual([PIXEL_CELL, PIXEL_CELL]);
        expect(b.pixels).toHaveLength(PIXEL_CELL * PIXEL_CELL);
        for (const v of b.pixels) expect(v === PIXEL_TRANSPARENT || v < PIXEL_PALETTE.length).toBe(true);
        expect(b.pixels.some((v) => v !== PIXEL_TRANSPARENT)).toBe(true);
      }
    }
  });

  it('les couleurs rendues sont dans la palette et jamais #FF00FF dans un sprite', () => {
    const allowed = new Set(PIXEL_PALETTE.map((hex) => parseInt(hex.slice(1), 16)));
    for (const spec of Object.values(SPECS)) {
      for (const b of allBitmaps(spec)) {
        const rgba = bitmapToRgba(b, 1, null);
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] === 0) continue;
          const rgb = (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!;
          expect(allowed.has(rgb)).toBe(true);
          expect(rgb).not.toBe(0xff00ff);
        }
      }
    }
  });
});

describe('Planches', () => {
  it('ont la taille demandée : 1024×512, 1024×768, 1024×512, fond magenta', () => {
    const spec = SPECS.blonde!;
    const faces = renderSheet(spec, 'faces');
    const walk = renderSheet(spec, 'walk');
    const poses = renderSheet(spec, 'poses');
    expect([faces.width, faces.height]).toEqual([1024, 512]);
    expect([walk.width, walk.height]).toEqual([1024, 768]);
    expect([poses.width, poses.height]).toEqual([1024, 512]);
    for (const s of [faces, walk, poses]) {
      expect(s.rgba).toHaveLength(s.width * s.height * 4);
      expect(Array.from(s.rgba.subarray(0, 4))).toEqual([255, 0, 255, 255]);
    }
  });

  it('le magenta n’y apparaît qu’à la place des pixels transparents', () => {
    const spec = SPECS.chignon!;
    const walk = renderSheet(spec, 'walk');
    const cell = PIXEL_CELL * 8;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const b = drawWalk(spec, DIRS[r]!, FRAMES[c]!);
        for (let y = 0; y < PIXEL_CELL; y++) {
          for (let x = 0; x < PIXEL_CELL; x++) {
            const o = ((r * cell + y * 8) * walk.width + c * cell + x * 8) * 4;
            const magenta = walk.rgba[o] === 255 && walk.rgba[o + 1] === 0 && walk.rgba[o + 2] === 255;
            expect(magenta).toBe(!opaque(b, x, y));
          }
        }
      }
    }
  });

  it('bitmapToRgba agrandit à l’entier et garde la transparence sans fond', () => {
    const b = drawFace(SPECS.blonde!, 'neutre');
    const rgba = bitmapToRgba(b, 3, null);
    expect(rgba).toHaveLength(96 * 96 * 4);
    expect(rgba[3]).toBe(0);
    expect(bitmapToRgba(b, 2.6, null)).toHaveLength(96 * 96 * 4);
  });

  it('mirrorBitmap retourne l’image et revient à l’original en le refaisant', () => {
    const b = drawWalk(SPECS.pointes!, 'side', 1);
    const m = mirrorBitmap(b);
    expect(at(m, 0, 20)).toBe(at(b, 31, 20));
    expect(Array.from(mirrorBitmap(m).pixels)).toEqual(Array.from(b.pixels));
  });
});

describe('Visages', () => {
  it('les 8 visages sont tous différents entre eux', () => {
    for (const spec of Object.values(SPECS)) {
      const faces = PIXEL_FACES.map((f) => drawFace(spec, f));
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          expect(Array.from(faces[i]!.pixels), `${PIXEL_FACES[i]} / ${PIXEL_FACES[j]}`).not.toEqual(
            Array.from(faces[j]!.pixels),
          );
        }
      }
    }
  });

  it('seuls les sourcils, les yeux, les joues, la larme et la bouche changent d’un visage à l’autre', () => {
    // Tête de 20 × 20 posée en (6, 6) : sourcils à partir de la ligne 10, menton en 25 ; colonnes 8 à 23.
    const inFeatures = (x: number, y: number) => x >= 8 && x <= 23 && y >= 10 && y <= 24;
    for (const spec of Object.values(SPECS)) {
      const base = drawFace(spec, 'neutre');
      for (const face of PIXEL_FACES) {
        const b = drawFace(spec, face);
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            if (at(b, x, y) === at(base, x, y)) continue;
            expect(inFeatures(x, y), `${face} : pixel (${x}, ${y}) hors du visage`).toBe(true);
          }
        }
        // Le contour extérieur ne bouge jamais : mêmes pixels transparents.
        for (let i = 0; i < b.pixels.length; i++) {
          expect(b.pixels[i] === PIXEL_TRANSPARENT).toBe(base.pixels[i] === PIXEL_TRANSPARENT);
        }
      }
    }
  });
});

describe('Marche', () => {
  const walkCells = (spec: CharacterSpec) =>
    DIRS.flatMap((d) => FRAMES.map((f) => ({ dir: d, frame: f, bitmap: drawWalk(spec, d, f) })));

  it('les pieds touchent la même ligne de sol dans les 12 cases', () => {
    for (const spec of Object.values(SPECS)) {
      const cells = walkCells(spec);
      expect(cells).toHaveLength(12);
      const grounds = new Set(cells.map((c) => lowestRow(c.bitmap)));
      expect(grounds.size).toBe(1);
      // Au moins un pied est posé sur la ligne de sol dans chaque case.
      for (const c of cells) expect(rows(c.bitmap, 30, 30).some((v) => v !== PIXEL_TRANSPARENT)).toBe(true);
    }
    // Les poses de corps entier partagent la même ligne de sol.
    const poseGrounds = new Set(PIXEL_POSES.map((p) => lowestRow(drawPose(SPECS.barbe!, p))));
    expect(poseGrounds).toEqual(new Set([...poseGrounds].slice(0, 1)));
    expect([...poseGrounds][0]).toBe(lowestRow(drawWalk(SPECS.barbe!, 'front', 0)));
  });

  it('les deux pieds alternent entre les images 2 et 4, et sont joints aux images 1 et 3', () => {
    for (const spec of Object.values(SPECS)) {
      for (const dir of DIRS) {
        const [f1, f2, f3, f4] = FRAMES.map((f) => drawWalk(spec, dir, f));
        const legs = (b: PixelBitmap) => rows(b, 26, 30);
        expect(legs(f2!)).not.toEqual(legs(f4!));
        expect(legs(f1!)).toEqual(legs(f3!));
        expect(legs(f1!)).not.toEqual(legs(f2!));
        if (dir !== 'side') {
          // De face et de dos, les jambes sont symétriques : l’image 4 est le miroir de l’image 2.
          const mask = (b: PixelBitmap) => legs(b).map((v) => v === PIXEL_TRANSPARENT);
          expect(mask(mirrorBitmap(f2!))).toEqual(mask(f4!));
        }
      }
    }
  });

  it('les bras alternent aussi (bras opposé au pied avant)', () => {
    const f2 = drawWalk(SPECS.barbe!, 'front', 1);
    const f4 = drawWalk(SPECS.barbe!, 'front', 3);
    // Mêmes formes en miroir (l’ombrage reste en bas à droite, il n’est donc pas comparé).
    const shape = (b: PixelBitmap) => rows(b, 20, 25).map((v) => v === PIXEL_TRANSPARENT);
    expect(shape(mirrorBitmap(f2))).toEqual(shape(f4));
    expect(shape(f2)).not.toEqual(shape(f4));
  });

  it('l’identité est la même dans toutes les cases : la tête ne change pas d’une image à l’autre', () => {
    for (const spec of Object.values(SPECS)) {
      for (const dir of DIRS) {
        const heads = FRAMES.map((f) => rows(drawWalk(spec, dir, f), 0, 19));
        for (const h of heads) expect(h).toEqual(heads[0]);
      }
    }
  });

  it('de dos, aucun visage : ni yeux blancs ni bouche', () => {
    const b = drawWalk(SPECS.blonde!, 'back', 0);
    const front = drawWalk(SPECS.blonde!, 'front', 0);
    expect(Array.from(b.pixels)).not.toEqual(Array.from(front.pixels));
    // Les pixels blancs de la tête (reflet des yeux) n’existent que de face.
    const whites = (bm: PixelBitmap) => rows(bm, 7, 19).filter((v) => v === 1).length;
    expect(whites(b)).toBe(0);
    expect(whites(front)).toBeGreaterThan(0);
  });
});

describe('Poses', () => {
  it('les 8 poses sont différentes', () => {
    const poses = PIXEL_POSES.map((p) => Array.from(drawPose(SPECS.rose!, p).pixels).join(','));
    expect(new Set(poses).size).toBe(8);
  });
});

describe('Déterminisme et personnages tirés au hasard', () => {
  it('même spécification, mêmes pixels', () => {
    for (const spec of Object.values(SPECS)) {
      const a = allBitmaps(spec).map((b) => Array.from(b.pixels).join(','));
      const b = allBitmaps({ ...spec }).map((x) => Array.from(x.pixels).join(','));
      expect(a).toEqual(b);
    }
    const sheetA = renderSheet(SPECS.rose!, 'walk').rgba;
    const sheetB = renderSheet({ ...SPECS.rose! }, 'walk').rgba;
    expect(Buffer.from(sheetA).equals(Buffer.from(sheetB))).toBe(true);
  });

  it('un spécification sans barbe ni couleur d’yeux se dessine comme une spécification à valeurs par défaut', () => {
    const base = defaultCharacterFor('Camille');
    const explicit = { ...base, facialHair: 0, eyeColor: 0 };
    expect(Array.from(drawFace(base, 'content').pixels)).toEqual(Array.from(drawFace(explicit, 'content').pixels));
  });

  it('50 personnages au hasard : sprites valides, rien hors palette, aucun trou dans le contour', () => {
    const next = lcg(20260605);
    for (let n = 0; n < 50; n++) {
      const spec = randomSpec(next);
      expect(characterSchema.safeParse(spec).success).toBe(true);
      for (const b of allBitmaps(spec)) {
        expect(b.width * b.height).toBe(1024);
        for (const v of b.pixels) {
          if (v !== PIXEL_TRANSPARENT && v >= PIXEL_PALETTE.length) throw new Error(`pixel hors palette : ${v}`);
        }
        expect(contourHoles(b), JSON.stringify(spec)).toBe(0);
      }
      // Pieds à la même ligne de sol.
      const grounds = new Set(DIRS.flatMap((d) => FRAMES.map((f) => lowestRow(drawWalk(spec, d, f)))));
      expect(grounds.size).toBe(1);
    }
  });

  it('couvre toutes les coiffures, tous les accessoires et les deux pilosités sans sortir de la grille', () => {
    for (let hair = 0; hair < CHARACTER_HAIR_STYLES.length; hair++) {
      for (let accessory = 0; accessory < CHARACTER_ACCESSORIES.length; accessory++) {
        for (const facialHair of [0, 1, 2]) {
          const spec: CharacterSpec = { body: 0, skin: 2, hair, hairColor: 1, accessory, facialHair, eyeColor: 2 };
          for (const b of [drawFace(spec, 'surpris'), drawWalk(spec, 'side', 1), drawPose(spec, 'joie')]) {
            expect(contourHoles(b)).toBe(0);
            // Marge d’au moins une ligne en haut : rien n’est rogné par le bord de l’image.
            expect(rows(b, 0, 0).every((v) => v === PIXEL_TRANSPARENT)).toBe(true);
          }
        }
      }
    }
  });
});
