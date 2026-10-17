import { describe, expect, it } from 'vitest';
import { DEFAULT_PACKAGE_LIMITS, imageDimensions, imageProblem } from '../packages/format.js';

/** En-tête PNG minimal : signature et IHDR, avec largeur et hauteur en gros-boutiste. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** JPEG minimal : un segment APP0 facultatif, puis le cadre (SOF0) qui porte les dimensions. */
function jpeg(width: number, height: number, withAppSegment = false): Uint8Array {
  const app = withAppSegment ? [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00] : [];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ];
  return new Uint8Array([0xff, 0xd8, ...app, ...sof, 0xff, 0xd9]);
}

function le32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Conteneur RIFF WebP avec un seul morceau. */
function webp(chunk: string, payload: number[]): Uint8Array {
  const pad = payload.length % 2 === 1 ? [0] : [];
  const head = [
    0x52,
    0x49,
    0x46,
    0x46,
    ...le32(4 + 8 + payload.length + pad.length),
    0x57,
    0x45,
    0x42,
    0x50,
    ...[...chunk].map((c) => c.charCodeAt(0)),
    ...le32(payload.length),
  ];
  return new Uint8Array([...head, ...payload, ...pad]);
}

function vp8x(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return webp('VP8X', [
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]);
}

function vp8(width: number, height: number): Uint8Array {
  return webp('VP8 ', [
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
  ]);
}

function vp8l(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return webp('VP8L', [0x2f, ...le32(bits)]);
}

const limits = DEFAULT_PACKAGE_LIMITS;

describe('dimensions des images : lecture des en-têtes', () => {
  it('lit la taille exacte de chaque format, sans décoder l’image', () => {
    expect(imageDimensions(png(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(jpeg(800, 600, true))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(vp8x(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(vp8(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(vp8l(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('renvoie null quand l’en-tête est tronqué ou sans cadre', () => {
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0]))).toBeNull();
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('dimensions des images : limite du côté le plus long, pour tous les formats', () => {
  it('accepte une image au côté exactement égal à la limite', () => {
    expect(imageProblem(vp8x(1024, 1024), '.webp', limits)).toBeNull();
    expect(imageProblem(jpeg(1024, 1024), '.jpg', limits)).toBeNull();
    expect(imageProblem(png(1024, 1024), '.png', limits)).toBeNull();
  });

  it('refuse un JPEG trop large, même petit en octets', () => {
    expect(imageProblem(jpeg(4000, 100), '.jpg', limits)).toContain('trop grande');
  });

  it('refuse un JPEG trop haut, avec un segment APP0 avant le cadre', () => {
    expect(imageProblem(jpeg(100, 2000, true), '.jpeg', limits)).toContain('trop grande');
  });

  it('refuse un WebP étendu (VP8X) trop large', () => {
    expect(imageProblem(vp8x(1200, 100), '.webp', limits)).toContain('trop grande');
  });

  it('refuse un WebP à compression avec perte (VP8) trop large', () => {
    expect(imageProblem(vp8(1100, 50), '.webp', limits)).toContain('trop grande');
    expect(imageProblem(vp8(800, 800), '.webp', limits)).toBeNull();
  });

  it('refuse un WebP sans perte (VP8L) trop large', () => {
    expect(imageProblem(vp8l(2000, 10), '.webp', limits)).toContain('trop grande');
    expect(imageProblem(vp8l(640, 480), '.webp', limits)).toBeNull();
  });
});

describe('dimensions des images : signature et lisibilité', () => {
  it('refuse une signature qui ne correspond pas à l’extension', () => {
    expect(imageProblem(png(100, 100), '.jpg', limits)).toBe('fichier JPEG invalide');
    expect(imageProblem(jpeg(100, 100), '.png', limits)).toBe('fichier .png invalide');
  });

  it('refuse une image dont les dimensions ne se lisent pas', () => {
    expect(imageProblem(new Uint8Array([0xff, 0xd8, 0xff, 0xc0]), '.jpg', limits)).toBe(
      'dimensions de l’image illisibles',
    );
  });
});
