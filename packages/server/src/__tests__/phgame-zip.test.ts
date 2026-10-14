import { describe, expect, it } from 'vitest';
import { readZip, writeZip, ZipError, type ZipReadLimits } from '../packages/zip.js';

const LIMITS: ZipReadLimits = {
  maxEntries: 50,
  maxEntryBytes: 1 << 20,
  maxTotalBytes: 4 << 20,
  maxRatio: 100,
  ratioCheckBytes: 1 << 20,
};
const allowAll = () => {};
const enc = (text: string) => new TextEncoder().encode(text);

/** Position de l'en-tête du premier fichier dans le répertoire central. */
function centralOffset(bytes: Uint8Array): number {
  const sig = [0x50, 0x4b, 0x01, 0x02];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (sig.every((b, k) => bytes[i + k] === b)) return i;
  }
  throw new Error('répertoire central introuvable');
}

describe('archive ZIP restreinte', () => {
  it('relit ce qui a été écrit, noms triés', () => {
    const bytes = writeZip([
      { name: 'b.txt', data: enc('deux') },
      { name: 'a/x.json', data: enc('{"un":1}') },
    ]);
    const entries = readZip(bytes, LIMITS, allowAll);
    expect(entries.map((e) => e.name)).toEqual(['a/x.json', 'b.txt']);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('{"un":1}');
  });

  it('applique le contrôle de noms à chaque entrée', () => {
    const bytes = writeZip([{ name: 'a.txt', data: enc('1') }]);
    expect(() =>
      readZip(bytes, LIMITS, () => {
        throw new ZipError('nom refusé');
      }),
    ).toThrow('nom refusé');
  });

  it('refuse une entrée en double', () => {
    const make = () =>
      readZip(writeZip([{ name: 'a', data: enc('1') }, { name: 'a', data: enc('2') }]), LIMITS, allowAll);
    expect(make).toThrow();
  });

  it('détecte une somme de contrôle incorrecte', () => {
    const bytes = writeZip([{ name: 'a.txt', data: enc('contenu') }]);
    const copy = new Uint8Array(bytes);
    copy[centralOffset(copy) + 16] ^= 0xff; // CRC-32 du répertoire central
    expect(() => readZip(copy, LIMITS, allowAll)).toThrow(ZipError);
  });

  it('refuse les liens symboliques', () => {
    const bytes = writeZip([{ name: 'a.txt', data: enc('contenu') }]);
    const copy = new Uint8Array(bytes);
    new DataView(copy.buffer).setUint32(centralOffset(copy) + 38, 0o120777 * 65536, true);
    expect(() => readZip(copy, LIMITS, allowAll)).toThrow(ZipError);
  });

  it('refuse les entrées chiffrées', () => {
    const bytes = writeZip([{ name: 'a.txt', data: enc('contenu') }]);
    const copy = new Uint8Array(bytes);
    new DataView(copy.buffer).setUint16(centralOffset(copy) + 8, 0x0001, true);
    expect(() => readZip(copy, LIMITS, allowAll)).toThrow(ZipError);
  });

  it('refuse une archive contenant trop d’entrées', () => {
    const bytes = writeZip([
      { name: 'a', data: enc('1') },
      { name: 'b', data: enc('2') },
      { name: 'c', data: enc('3') },
    ]);
    expect(() => readZip(bytes, { ...LIMITS, maxEntries: 2 }, allowAll)).toThrow(ZipError);
  });

  it('refuse une entrée dont la taille dépasse la limite', () => {
    const bytes = writeZip([{ name: 'a', data: new Uint8Array(100) }]);
    expect(() => readZip(bytes, { ...LIMITS, maxEntryBytes: 10 }, allowAll)).toThrow(ZipError);
  });

  it('refuse un taux de compression suspect (archive piégée)', () => {
    const bytes = writeZip([{ name: 'z', data: new Uint8Array(2 << 20) }]);
    expect(() => readZip(bytes, { ...LIMITS, maxEntryBytes: 4 << 20, maxTotalBytes: 8 << 20 }, allowAll)).toThrow(
      ZipError,
    );
  });

  it('refuse un fichier qui n’est pas une archive', () => {
    expect(() => readZip(enc('pas une archive '.repeat(20)), LIMITS, allowAll)).toThrow(ZipError);
  });
});
