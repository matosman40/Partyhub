import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ASSET_LIMIT_BYTES } from '../assets/service.js';

const MB = 1024 * 1024;
const base = { DATA_DIR: '/tmp/ph-config-test' };

describe('créations de profil par adresse', () => {
  it('reprend la limite par défaut de 40 créations par quart d’heure', () => {
    expect(loadConfig(base).profileCreationsPerIp).toBe(40);
  });

  it('lit la limite depuis l’environnement (tests navigateur de la CI)', () => {
    expect(loadConfig({ ...base, PROFILE_CREATIONS_PER_IP: '400' }).profileCreationsPerIp).toBe(400);
  });

  it('refuse une valeur nulle ou non numérique', () => {
    expect(() => loadConfig({ ...base, PROFILE_CREATIONS_PER_IP: '0' })).toThrow(/PROFILE_CREATIONS_PER_IP/);
  });
});

describe('limites de taille de la médiathèque', () => {
  it('reprend les limites par défaut du serveur', () => {
    expect(loadConfig(base).assetLimits).toEqual(ASSET_LIMIT_BYTES);
  });

  it('lit les limites depuis l’environnement', () => {
    const limits = loadConfig({
      ...base,
      ASSET_MAX_AUDIO_MB: '2',
      ASSET_MAX_VIDEO_MB: '100',
      ASSET_MAX_IMAGE_MB: '1',
      ASSET_MAX_FONT_MB: '3',
    }).assetLimits;
    expect(limits).toEqual({ audio: 2 * MB, video: 100 * MB, image: 1 * MB, font: 3 * MB });
  });

  it('refuse une valeur hors bornes ou non numérique', () => {
    expect(() => loadConfig({ ...base, ASSET_MAX_IMAGE_MB: '0' })).toThrow(/ASSET_MAX_IMAGE_MB/);
    expect(() => loadConfig({ ...base, ASSET_MAX_VIDEO_MB: 'beaucoup' })).toThrow(/ASSET_MAX_VIDEO_MB/);
  });
});
