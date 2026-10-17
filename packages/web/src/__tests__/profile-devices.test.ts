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

type Session = typeof import('../profile/session.js');

/** Un onglet : son propre sessionStorage, et le localStorage partagé de l'appareil (`store`). */
async function openTab(): Promise<{ run: <T>(fn: (s: Session) => T) => T }> {
  const tabStore = new Map<string, string>();
  const tabStorage = {
    getItem: (k: string) => tabStore.get(k) ?? null,
    setItem: (k: string, v: string) => void tabStore.set(k, v),
    removeItem: (k: string) => void tabStore.delete(k),
  };
  vi.stubGlobal('sessionStorage', tabStorage);
  vi.resetModules();
  const mod = await import('../profile/session.js');
  return {
    run: (fn) => {
      vi.stubGlobal('sessionStorage', tabStorage);
      return fn(mod);
    },
  };
}

describe('Un profil par onglet', () => {
  it('changer de joueur dans un onglet ne change pas celui des autres onglets', async () => {
    rememberDeviceProfile(lea);
    rememberDeviceProfile(max, false);
    const tab1 = await openTab();
    const tab2 = await openTab();
    expect(tab1.run((s) => s.readProfileToken())).toBe('t-lea');
    tab2.run((s) => s.switchDeviceProfile('t-max'));
    expect(tab2.run((s) => s.readProfileToken())).toBe('t-max');
    expect(tab1.run((s) => s.readProfileToken())).toBe('t-lea');
  });

  it('un nouvel onglet prend le profil actif de l’appareil', async () => {
    rememberDeviceProfile(lea);
    rememberDeviceProfile(max, false);
    switchDeviceProfile('t-max');
    const tab = await openTab();
    expect(tab.run((s) => s.readProfileToken())).toBe('t-max');
  });
});
