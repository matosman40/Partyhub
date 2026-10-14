import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardGameDefinition, MediaQuizDefinition } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Modification des jeux intégrés, export/import des jeux de cartes et sauvegarde complète.
 * Tout passe par HTTP, comme dans l'administration réelle.
 */

let server: PartyServer;
let dataDir: string;
let base: string;
let cookie: string;

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { cookie, ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Un jeu de cartes valide : assez de cartes pour 4 joueurs à 5 cartes (25 minimum). */
function cardDefinition(name: string): CardGameDefinition {
  return {
    name,
    description: 'Jeu de test.',
    icon: '🎴',
    theme: 'arcade',
    families: [
      { id: 'rouge', label: 'Rouge', color: '#ff4d5a' },
      { id: 'bleu', label: 'Bleu', color: '#3f8cff' },
    ],
    cards: [
      { id: 'un-r', label: '1', symbol: '1', family: 'rouge', effect: 'none', count: 12, points: 1 },
      { id: 'un-b', label: '1', symbol: '1', family: 'bleu', effect: 'none', count: 12, points: 1 },
      { id: 'joker', label: 'Joker', symbol: '★', family: 'wild', effect: 'wild', count: 4, points: 30 },
    ],
    rules: { minPlayers: 2, maxPlayers: 4, handSize: 5, matchOn: 'family', targetScore: 200, turnSeconds: 20 },
    notice: { goal: 'Vider sa main.', steps: ['Posez une carte.'], tips: [] },
  } as CardGameDefinition;
}

/** Un jeu de questions médias de 60 extraits YouTube : plus gros que l'ancienne limite de 4 Ko. */
function bigMediaDefinition(name: string): MediaQuizDefinition {
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: `extrait-${i + 1}`,
    answer: `Titre numéro ${i + 1} avec un libellé assez long pour peser`,
    aliases: [`Alias ${i + 1} longue formulation`, `Autre ${i + 1}`],
    detail: `Précision ${i + 1} : réalisateur, année et contexte de la scène`,
    source: { type: 'youtube' as const, videoId: `abcdefgh${String(i % 10).padStart(3, '0')}` },
    startSec: i,
    durationSec: 20,
  }));
  return {
    mode: 'devine',
    kind: 'film',
    name,
    description: 'Grand jeu de test.',
    icon: '🎬',
    rules: { questionCount: 8, answerSeconds: 30, speedBonus: true },
    items,
  } as MediaQuizDefinition;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-transfer-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: join(dataDir, 'test.db'),
    staticDir: join(dataDir, 'static-absent'),
    adminPassword: 'transfer-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'transfer-password-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Jeux intégrés modifiables', () => {
  it('le nom, l’icône et la description surchargés apparaissent au catalogue et dans la salle', async () => {
    const put = await call('/api/admin/game-details/sudoku', {
      method: 'PUT',
      json: { name: 'Sudoku du dimanche', icon: '🧠', description: 'Une grille à faire en famille.' },
    });
    expect(put.status).toBe(200);

    const admin = await call('/api/admin/overview');
    const entry = admin.data.games.find((g: any) => g.id === 'sudoku');
    expect(entry.name).toBe('Sudoku du dimanche');
    expect(entry.customDetails).toBe(true);
    expect(entry.defaultDetails.name).toBe('Sudoku');

    const room = await call('/api/rooms', { method: 'POST', json: { gameId: 'sudoku', practice: false } });
    expect(room.status).toBe(201);
    expect(room.data.game.name).toBe('Sudoku du dimanche');
    expect(room.data.game.icon).toBe('🧠');
  });

  it('refuse de modifier un jeu créé dans l’administration ici, et une présentation invalide', async () => {
    const other = await call('/api/admin/game-details/custom-inexistant', {
      method: 'PUT',
      json: { name: 'Nom valide', icon: '🎴', description: 'Texte' },
    });
    expect(other.status).toBe(404);

    const invalid = await call('/api/admin/game-details/taquin', {
      method: 'PUT',
      json: { name: 'Ta', icon: '🧩', description: 'Texte' },
    });
    expect(invalid.status).toBe(400);
  });

  it('restaure le nom d’origine', async () => {
    const del = await call('/api/admin/game-details/sudoku', { method: 'DELETE' });
    expect(del.status).toBe(200);
    const admin = await call('/api/admin/overview');
    const entry = admin.data.games.find((g: any) => g.id === 'sudoku');
    expect(entry.name).toBe('Sudoku');
    expect(entry.customDetails).toBe(false);
  });
});

describe('Export et import', () => {
  let cardId = '';

  it('exporte un jeu de cartes, qui se réimporte comme un nouveau jeu', async () => {
    const created = await call('/api/admin/card-games', { method: 'POST', json: cardDefinition('Cartes exportées') });
    expect(created.status).toBe(201);
    cardId = created.data.id;

    const exported = await call(`/api/admin/card-games/${cardId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.data.format).toBe('partyhub-jeux-cartes');
    expect(exported.data.definition.name).toBe('Cartes exportées');

    const imported = await call('/api/admin/card-games/import', { method: 'POST', json: exported.data });
    expect(imported.status).toBe(201);
    expect(imported.data.id).not.toBe(cardId);

    const list = await call('/api/admin/card-games');
    expect(list.data.games.filter((g: any) => g.definition.name === 'Cartes exportées')).toHaveLength(2);
  });

  it('refuse un fichier qui n’est pas un jeu de cartes', async () => {
    const res = await call('/api/admin/card-games/import', {
      method: 'POST',
      json: { format: 'partyhub-questions-medias', version: 1, definition: {} },
    });
    expect(res.status).toBe(400);
  });

  it('accepte une définition de médias de 60 extraits (au-delà de l’ancienne limite de 4 Ko)', async () => {
    const res = await call('/api/admin/media-games', { method: 'POST', json: bigMediaDefinition('Grand jeu de test') });
    expect(res.status).toBe(201);
  });
});

describe('Sauvegarde complète', () => {
  it('sauvegarde les jeux personnalisés et la présentation modifiée, puis la restaure', async () => {
    await call('/api/admin/game-details/taquin', {
      method: 'PUT',
      json: { name: 'Taquin du salon', icon: '🧩', description: 'Les tuiles, en famille.' },
    });

    const backup = await call('/api/admin/backup');
    expect(backup.status).toBe(200);
    expect(backup.data.format).toBe('partyhub-sauvegarde');
    expect(backup.data.cardGames.length).toBeGreaterThanOrEqual(2);
    expect(backup.data.mediaGames.length).toBeGreaterThanOrEqual(1);
    expect(backup.data.gameDetails.taquin.name).toBe('Taquin du salon');

    await call('/api/admin/game-details/taquin', { method: 'DELETE' });
    const restored = await call('/api/admin/backup/import', { method: 'POST', json: backup.data });
    expect(restored.status).toBe(200);
    expect(restored.data.summary.cardGames).toBe(backup.data.cardGames.length);
    expect(restored.data.summary.mediaGames).toBe(backup.data.mediaGames.length);
    expect(restored.data.summary.details).toBe(1);

    const admin = await call('/api/admin/overview');
    expect(admin.data.games.find((g: any) => g.id === 'taquin').name).toBe('Taquin du salon');
  });

  it('refuse une sauvegarde qui ne suit pas le format', async () => {
    const res = await call('/api/admin/backup/import', { method: 'POST', json: { format: 'autre', version: 1 } });
    expect(res.status).toBe(400);
  });
});
