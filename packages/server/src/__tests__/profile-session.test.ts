import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../db/store.js';
import { ProfileService } from '../profiles/service.js';

/**
 * Session d'un profil « nom seul » : son jeton est le seul moyen de le retrouver sur l'appareil.
 * La session se prolonge à chaque usage, au-delà de la durée de base de 90 jours.
 */

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-session-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Session glissante des profils', () => {
  it('reste valable tant qu’on s’en sert, et expire après une absence prolongée', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const service = new ProfileService(store, () => now);
    const { token } = await service.register({ displayName: 'Léa' });

    // 80 jours plus tard : toujours valable, et prolongé de 90 jours (il reste moins de 45 jours).
    now += 80 * DAY;
    expect(service.authenticate(token)).toBeDefined();

    // 150 jours après la création : sans prolongation, la session serait morte à 90 jours.
    now += 70 * DAY;
    expect(service.authenticate(token)).toBeDefined();

    // Une absence de plus de 90 jours : la session expire.
    now += 100 * DAY;
    expect(service.authenticate(token)).toBeUndefined();
  });

  it('un jeton inconnu ne donne aucun profil', () => {
    const service = new ProfileService(store, () => Date.now());
    expect(service.authenticate('jeton-inventé')).toBeUndefined();
  });
});
