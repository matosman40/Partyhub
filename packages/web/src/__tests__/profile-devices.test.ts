import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeDeviceProfile,
  forgetDeviceProfile,
  readDeviceProfiles,
  readProfileToken,
  rememberDeviceProfile,
  renameDeviceProfile,
  replaceActiveToken,
  switchDeviceProfile,
} from '../profile/session.js';

/**
 * Profils de cet appareil : plusieurs profils « nom seul », un actif, et la liste qui suit.
 * Le stockage est simulé ; les événements de la fenêtre sont sans effet ici.
 */

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lea = { token: 't-lea', id: 'id-lea', name: 'Léa' };
const max = { token: 't-max', id: 'id-max', name: 'Max' };

describe('Profils de l’appareil', () => {
  it('ajoute un profil et le rend actif', () => {
    rememberDeviceProfile(lea);
    expect(readDeviceProfiles()).toEqual([lea]);
    expect(readProfileToken()).toBe('t-lea');
    expect(activeDeviceProfile()).toEqual(lea);
  });

  it('ajoute sans changer le profil actif quand on crée le profil d’un autre joueur', () => {
    rememberDeviceProfile(lea);
    rememberDeviceProfile(max, false);
    expect(readDeviceProfiles().map((p) => p.name)).toEqual(['Léa', 'Max']);
    expect(activeDeviceProfile()?.name).toBe('Léa');
  });

  it('change de profil actif sans toucher à la liste', () => {
    rememberDeviceProfile(lea);
    rememberDeviceProfile(max, false);
    switchDeviceProfile('t-max');
    expect(activeDeviceProfile()?.name).toBe('Max');
    expect(readDeviceProfiles()).toHaveLength(2);
  });

  it('retirer le profil actif rend actif le premier restant', () => {
    rememberDeviceProfile(lea);
    rememberDeviceProfile(max, false);
    forgetDeviceProfile('t-lea');
    expect(readDeviceProfiles()).toEqual([max]);
    expect(activeDeviceProfile()?.name).toBe('Max');
  });

  it('retirer le dernier profil ne laisse aucun profil actif', () => {
    rememberDeviceProfile(lea);
    forgetDeviceProfile('t-lea');
    expect(readDeviceProfiles()).toEqual([]);
    expect(readProfileToken()).toBeNull();
    expect(activeDeviceProfile()).toBeNull();
  });

  it('suit un nouveau jeton (mot de passe changé) et un nouveau pseudo', () => {
    rememberDeviceProfile(lea);
    replaceActiveToken('t-lea-2');
    renameDeviceProfile('id-lea', 'Léa B.');
    expect(activeDeviceProfile()).toEqual({ token: 't-lea-2', id: 'id-lea', name: 'Léa B.' });
  });

  it('ignore les entrées abîmées dans la liste', () => {
    store.set('ph:profiles', JSON.stringify([lea, { token: 42 }, null, 'texte']));
    expect(readDeviceProfiles()).toEqual([lea]);
    store.set('ph:profiles', 'pas du json');
    expect(readDeviceProfiles()).toEqual([]);
  });
});
