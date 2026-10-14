import { describe, expect, it } from 'vitest';
import { DEVICE_CHOICES, readDeviceChoice, writeDeviceChoice } from '../device/device.js';

/** Hors navigateur, il n'y a pas de stockage : le choix retombe sur la détection automatique. */
describe('choix manuel de l’appareil', () => {
  it('propose la détection automatique et les quatre types, sans « inconnu »', () => {
    expect(DEVICE_CHOICES).toEqual(['auto', 'phone', 'tablet', 'tv', 'desktop']);
  });

  it('sans stockage, le choix par défaut est la détection', () => {
    expect(readDeviceChoice()).toBe('auto');
  });

  it('écrire un choix sans stockage ne lève pas d’erreur', () => {
    expect(() => writeDeviceChoice('tablet')).not.toThrow();
    expect(() => writeDeviceChoice('auto')).not.toThrow();
  });
});
