import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameInfo } from '../catalog.js';
import { Store } from '../db/store.js';
import { resolveGame } from '../games-registry.js';
import { ProfileService } from '../profiles/service.js';

/**
 * Drapeau « avec IA » du catalogue, et nom des jeux renommés par l'administrateur dans les statistiques des profils.
 */

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-catalog-info-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function module(id: string) {
  const found = resolveGame(id);
  if (!found) throw new Error(`jeu introuvable : ${id}`);
  return found;
}

describe('drapeau « avec IA »', () => {
  it('marque les jeux qui s’appuient sur une IA, et seulement ceux-là', () => {
    expect(gameInfo(module('quiz-party')).ai).toBe(true);
    expect(gameInfo(module('phrases-trous')).ai).toBe(true);
    expect(gameInfo(module('aventure-ia')).ai).toBe(true);
    expect(gameInfo(module('reflexe')).ai).toBe(false);
    expect(gameInfo(module('bombes-party')).ai).toBe(false);
  });
});

describe('statistiques des profils', () => {
  it('affichent le nom donné par l’administrateur, puis celui du code après restauration', async () => {
    const service = new ProfileService(store, () => Date.now());
    const { token } = await service.register({ displayName: 'Léa' });
    const profileId = service.authenticate(token);
    expect(profileId).toBeDefined();
    service.recordResult(profileId!, 'quiz-party', 12, true);

    expect(service.stats(profileId!).perGame[0]?.name).toBe('Quiz Party');

    store.setDetailsOverride(
      'quiz-party',
      JSON.stringify({ name: 'Quiz des copains', icon: '🧠', description: 'Questions entre amis.', durationMin: 10 }),
    );
    expect(service.stats(profileId!).perGame[0]?.name).toBe('Quiz des copains');

    store.clearDetailsOverride('quiz-party');
    expect(service.stats(profileId!).perGame[0]?.name).toBe('Quiz Party');
  });
});
