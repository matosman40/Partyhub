import { describe, expect, it } from 'vitest';
import {
  describeMediaError,
  formatBytes,
  levelFromBytes,
  permissionLabel,
  unavailableMessage,
} from '../device/mediaTest.js';

/** Page de test des appareils : messages d'erreur, niveau sonore, libellés et tailles. */

const named = (name: string) => Object.assign(new Error('x'), { name });

describe('Erreurs d’accès aux appareils', () => {
  it('explique le refus d’autorisation et où la rétablir', () => {
    expect(describeMediaError(named('NotAllowedError'))).toMatch(/Autorisez/);
    expect(describeMediaError(named('PermissionDeniedError'))).toMatch(/Autorisez/);
  });

  it('distingue un appareil absent, occupé, ou une contrainte non tenue', () => {
    expect(describeMediaError(named('NotFoundError'))).toMatch(/Aucun appareil/);
    expect(describeMediaError(named('NotReadableError'))).toMatch(/autre application/);
    expect(describeMediaError(named('OverconstrainedError'))).toMatch(/caméra arrière/);
  });

  it('signale une page non sécurisée', () => {
    expect(describeMediaError(named('SecurityError'))).toMatch(/HTTPS/);
  });

  it('a un message de repli pour une erreur inconnue ou non objet', () => {
    expect(describeMediaError(named('Chose'))).toMatch(/Impossible/);
    expect(describeMediaError(undefined)).toMatch(/Impossible/);
    expect(describeMediaError('texte')).toMatch(/Impossible/);
  });
});

describe('Niveau sonore', () => {
  it('reste à zéro pour le silence (valeurs centrées sur 128)', () => {
    expect(levelFromBytes(new Uint8Array(256).fill(128))).toBe(0);
  });

  it('monte avec l’amplitude et ne dépasse jamais 1', () => {
    const quiet = levelFromBytes(Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 140 : 116)));
    const loud = levelFromBytes(Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 255 : 0)));
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1);
  });

  it('vaut zéro sans échantillon', () => {
    expect(levelFromBytes([])).toBe(0);
  });
});

describe('Libellés et tailles', () => {
  it('traduit l’état des autorisations', () => {
    expect(permissionLabel('granted')).toBe('accordée');
    expect(permissionLabel('denied')).toBe('refusée');
    expect(permissionLabel('prompt')).toBe('à demander');
    expect(permissionLabel('autre')).toBe('inconnue');
  });

  it('affiche les tailles en octets, Ko ou Mo', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 Mo');
  });
});

describe('Appareil indisponible', () => {
  it('dit que la page doit être en HTTPS quand elle ne l’est pas', () => {
    const msg = unavailableMessage('micro', false);
    expect(msg).toMatch(/HTTPS/);
    expect(msg).toMatch(/micro/);
  });

  it('signale seulement le navigateur quand la page est sécurisée', () => {
    const msg = unavailableMessage('caméra', true);
    expect(msg).not.toMatch(/HTTPS/);
    expect(msg).toMatch(/caméra/);
  });
});
