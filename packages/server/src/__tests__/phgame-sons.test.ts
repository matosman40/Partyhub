import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomFillSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import {
  DEFAULT_PACKAGE_LIMITS,
  PackageValidationError,
  PHGAME_FORMAT_VERSION,
  audioProblem,
  isAudioPath,
  validatePackage,
  type PackageLimits,
} from '../packages/format.js';
import { buildPackage, exampleDefinition, tinyPng } from './helpers/package-kit.js';

/** Octets aléatoires : une archive ne doit pas les compresser à l'excès (contrôle du rapport de compression). */
function noise(size: number, head: number[]): Uint8Array {
  const data = new Uint8Array(size);
  randomFillSync(data);
  data.set(head, 0);
  return data;
}

/** Octets d'un fichier Ogg minimal : signature « OggS » suivie de données quelconques. */
function ogg(size = 64): Uint8Array {
  return noise(size, [0x4f, 0x67, 0x67, 0x53]);
}

/** Octets d'un fichier MP3 minimal : étiquette ID3 suivie de données quelconques. */
function mp3(size = 64): Uint8Array {
  return noise(size, [0x49, 0x44, 0x33, 0x04]);
}

function issuesOf(bytes: Uint8Array, limits?: PackageLimits): string[] {
  try {
    validatePackage(bytes, limits);
    return [];
  } catch (err) {
    if (err instanceof PackageValidationError) return err.issues;
    throw err;
  }
}

/** Paquet de format 4 avec des sons, à partir du jeu de cartes d'exemple. */
function soundPackage(
  options: {
    sons?: unknown;
    files?: Record<string, Uint8Array>;
    undeclared?: string[];
    manifest?: (m: Record<string, any>) => void;
  } = {},
): Uint8Array {
  const sons = options.sons ?? {
    sfx: { place: 'assets/sons/sfx-place.ogg', die: 'assets/sons/sfx-die.mp3' },
    music: { partie: 'assets/sons/musique-partie.ogg' },
  };
  const files = options.files ?? {
    'assets/sons/sfx-place.ogg': ogg(),
    'assets/sons/sfx-die.mp3': mp3(),
    'assets/sons/musique-partie.ogg': ogg(),
  };
  return buildPackage({
    id: 'paquet-sons',
    definition: { ...exampleDefinition(), sons },
    files,
    undeclared: options.undeclared,
    manifest: (m) => {
      m.formatVersion = 4;
      m.engine.minVersion = '0.14.0';
      m.licenses[0].covers = Object.keys(files);
      options.manifest?.(m);
    },
  });
}

describe('format 4 : sons dans les paquets', () => {
  it('le format courant est la version 4', () => {
    expect(PHGAME_FORMAT_VERSION).toBe(4);
  });

  it('reconnaît les fichiers audio par leur extension seulement', () => {
    expect(isAudioPath('assets/sons/sfx-place.ogg')).toBe(true);
    expect(isAudioPath('assets/sons/sfx-place.MP3')).toBe(true);
    expect(isAudioPath('assets/cover.png')).toBe(false);
    expect(isAudioPath('assets/ogg')).toBe(false);
  });

  it('contrôle la signature de chaque format audio', () => {
    expect(audioProblem(ogg(), '.ogg')).toBeNull();
    expect(audioProblem(mp3(), '.mp3')).toBeNull();
    expect(audioProblem(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), '.mp3')).toBeNull();
    expect(audioProblem(tinyPng(8, 8), '.ogg')).toBe('fichier .ogg invalide');
    expect(audioProblem(ogg(), '.mp3')).toBe('fichier .mp3 invalide');
    expect(audioProblem(ogg(), '.wav')).toBe('type audio non admis');
  });

  it('accepte un paquet de format 4 avec des sons, et les rend disponibles', () => {
    const pkg = validatePackage(soundPackage());
    expect(pkg.manifest.formatVersion).toBe(4);
    expect(pkg.sounds).toEqual({
      sfx: { place: 'assets/sons/sfx-place.ogg', die: 'assets/sons/sfx-die.mp3' },
      music: { partie: 'assets/sons/musique-partie.ogg' },
    });
  });

  it('un paquet sans sons garde des sons vides', () => {
    expect(validatePackage(buildPackage()).sounds).toEqual({ sfx: {}, music: {} });
  });

  it('refuse des sons dans un paquet de format antérieur', () => {
    const issues = issuesOf(soundPackage({ manifest: (m) => (m.formatVersion = 3) }));
    expect(issues.join(' ')).toContain('les sons demandent le format 4');
  });

  it('refuse un format 4 qui demande un moteur plus ancien que 0.14.0', () => {
    const issues = issuesOf(soundPackage({ manifest: (m) => (m.engine.minVersion = '0.13.0') }));
    expect(issues.join(' ')).toContain('Le format 4 demande PartyHub 0.14.0 au minimum');
  });

  it('refuse un bruitage qui n’existe pas dans l’application', () => {
    const issues = issuesOf(soundPackage({ sons: { sfx: { bruit_inconnu: 'assets/sons/sfx-place.ogg' } } }));
    expect(issues.join(' ')).toContain('sons.sfx');
  });

  it('refuse une musique autre que celle de partie', () => {
    const issues = issuesOf(soundPackage({ sons: { music: { accueil: 'assets/sons/musique-partie.ogg' } } }));
    expect(issues.join(' ')).toContain('sons.music');
  });

  it('refuse un son hors de assets/, ou d’une extension non admise', () => {
    const outside = issuesOf(soundPackage({ sons: { sfx: { place: 'game/sfx.ogg' } } }));
    expect(outside.join(' ')).toContain('doit être un fichier .ogg ou .mp3 de assets/');
    const wav = issuesOf(soundPackage({ sons: { sfx: { place: 'assets/sons/sfx-place.wav' } } }));
    expect(wav.join(' ')).toContain('doit être un fichier .ogg ou .mp3 de assets/');
  });

  it('refuse un son qui n’est pas déclaré dans le manifeste', () => {
    const issues = issuesOf(soundPackage({ undeclared: ['assets/sons/sfx-place.ogg'] }));
    expect(issues.join(' ')).toContain('n’est pas déclaré dans le manifeste');
  });

  it('refuse un fichier audio dont le contenu n’est pas du son', () => {
    const issues = issuesOf(soundPackage({ files: { 'assets/sons/sfx-place.ogg': tinyPng(8, 8) } }));
    expect(issues.join(' ')).toContain('fichier .ogg invalide');
  });

  it('refuse un fichier audio trop lourd, puis un total trop lourd', () => {
    const big = noise(DEFAULT_PACKAGE_LIMITS.maxAudioBytes + 1, [0x4f, 0x67, 0x67, 0x53]);
    const heavy = issuesOf(soundPackage({ files: { 'assets/sons/sfx-place.ogg': big } }));
    expect(heavy.join(' ')).toContain('fichier audio trop lourd');

    const each = noise(400 * 1024, [0x4f, 0x67, 0x67, 0x53]);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 6; i++) files[`assets/sons/s${i}.ogg`] = each;
    const total = issuesOf(soundPackage({ sons: { sfx: { place: 'assets/sons/s0.ogg' } }, files }));
    expect(total.join(' ')).toContain('Sons trop lourds au total');
  });

  it('refuse plus de 16 fichiers audio', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 17; i++) files[`assets/sons/s${i}.ogg`] = ogg(16);
    const issues = issuesOf(soundPackage({ sons: { sfx: { place: 'assets/sons/s0.ogg' } }, files }));
    expect(issues.join(' ')).toContain('Trop de fichiers audio : 17');
  });

  it('refuse un fichier audio comme couverture', () => {
    const issues = issuesOf(
      soundPackage({
        manifest: (m) => (m.cover = 'assets/sons/sfx-place.ogg'),
      }),
    );
    expect(issues.join(' ')).toContain('La couverture doit être une image');
  });

  it('accepte une couverture image à côté des sons', () => {
    const pkg = validatePackage(
      soundPackage({
        files: {
          'assets/cover.png': tinyPng(64, 64),
          'assets/sons/sfx-place.ogg': ogg(),
        },
        sons: { sfx: { place: 'assets/sons/sfx-place.ogg' } },
        manifest: (m) => (m.cover = 'assets/cover.png'),
      }),
    );
    expect(pkg.manifest.cover).toBe('assets/cover.png');
  });
});

describe('service : sons par jeu importé', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sons-'));
    store = new Store(path.join(dir, 'partyhub.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renvoie les adresses publiques des sons d’un paquet installé, et rien pour les autres jeux', () => {
    const service = new PackageService(store, dir);
    expect(service.install(soundPackage())).toMatchObject({ ok: true, gameId: 'pkg-paquet-sons' });
    expect(service.gameSounds('pkg-paquet-sons')).toEqual({
      sfx: {
        place: '/api/packages/paquet-sons/assets/sons/sfx-place.ogg',
        die: '/api/packages/paquet-sons/assets/sons/sfx-die.mp3',
      },
      music: { partie: '/api/packages/paquet-sons/assets/sons/musique-partie.ogg' },
    });
    expect(service.gameSounds('banquise')).toEqual({ sfx: {}, music: {} });
    expect(service.gameSounds('pkg-inconnu')).toEqual({ sfx: {}, music: {} });
  });

  it('sert le fichier audio avec son type MIME', () => {
    const service = new PackageService(store, dir);
    service.install(soundPackage());
    const asset = service.asset('paquet-sons', 'assets/sons/sfx-place.ogg');
    expect(asset?.contentType).toBe('audio/ogg');
    expect(service.asset('paquet-sons', 'assets/sons/sfx-die.mp3')?.contentType).toBe('audio/mpeg');
  });

  it('retrouve les sons après redémarrage du service', () => {
    new PackageService(store, dir).install(soundPackage());
    const again = new PackageService(store, dir);
    expect(again.gameSounds('pkg-paquet-sons').sfx.place).toBe('/api/packages/paquet-sons/assets/sons/sfx-place.ogg');
  });

  it('un paquet désactivé ne renvoie plus ses sons', () => {
    const service = new PackageService(store, dir);
    service.install(soundPackage());
    expect(service.setEnabled('paquet-sons', false)).toBe(true);
    expect(service.gameSounds('pkg-paquet-sons')).toEqual({ sfx: {}, music: {} });
  });
});
