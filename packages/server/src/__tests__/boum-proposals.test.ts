import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Propositions de cartes BOUM ! : un joueur inscrit propose, seul l'administrateur valide. */

let base: string;
let dataDir: string;
let server: PartyServer;
let adminCookie: string;
let token: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-proposals-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const reg = await fetch(`${base}/api/profiles/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'proposeur01', password: 'motdepasse-123', displayName: 'Alice' }),
  });
  expect(reg.status).toBe(201);
  token = ((await reg.json()) as { token: string }).token;
});

afterAll(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function admin(path: string, init: RequestInit = {}) {
  return fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: adminCookie, ...(init.headers ?? {}) },
  });
}

function propose(body: Record<string, unknown>, asGuest = false) {
  return fetch(`${base}/api/profiles/me/boum-proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(asGuest ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

describe('Propositions BOUM ! (joueurs inscrits)', () => {
  it('refuse les invités', async () => {
    const res = await propose({ type: 'metier', level: 'doux', text: 'Dompteur de canards', certified: true }, true);
    expect(res.status).toBe(401);
  });

  it('exige la case de droits et refuse le niveau limite', async () => {
    const noCase = await propose({ type: 'metier', level: 'doux', text: 'Dompteur de canards' });
    expect(noCase.status).toBe(400);
    expect(((await noCase.json()) as { error: string }).error).toContain('Cochez');

    const limite = await propose({ type: 'metier', level: 'limite', text: 'Dompteur de canards', certified: true });
    expect(limite.status).toBe(400);
  });

  it('enregistre une proposition en attente, visible du seul auteur et de l’administrateur', async () => {
    const res = await propose({ type: 'metier', level: 'doux', text: 'Dompteur de canards', certified: true });
    expect(res.status).toBe(201);

    const mine = (await (
      await fetch(`${base}/api/profiles/me/boum-proposals`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { proposals: { text: string; state: string }[] };
    expect(mine.proposals.find((p) => p.text === 'Dompteur de canards')?.state).toBe('en_attente');

    const queue = (await (await admin('/boum/proposals')).json()) as {
      entries: { text: string; authorName: string }[];
    };
    expect(queue.entries.find((e) => e.text === 'Dompteur de canards')?.authorName).toBe('Alice');
  });

  it('applique le quota de 10 propositions par jour', async () => {
    for (let i = 1; i < 10; i += 1) {
      const res = await propose({
        type: 'metier',
        level: 'doux',
        text: `Métier numéro ${i} à inventer`,
        certified: true,
      });
      expect(res.status).toBe(201);
    }
    const over = await propose({ type: 'metier', level: 'doux', text: 'Métier de trop', certified: true });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toContain('par jour');
  });

  it('refuse une proposition avec une insulte de nom commercial interdit', async () => {
    const res = await propose({
      type: 'situation',
      level: 'doux',
      text: 'Une partie de Monopoly ratée',
      certified: true,
    });
    expect(res.status).toBe(400);
  });

  it('montre le motif de refus au seul auteur, et anonymise son nom à la suppression du compte', async () => {
    const queue = (await (await admin('/boum/proposals')).json()) as { entries: { id: string; text: string }[] };
    const target = queue.entries.find((e) => e.text === 'Dompteur de canards');
    expect(target).toBeDefined();

    const refused = await admin('/boum/entries/status', {
      method: 'POST',
      body: JSON.stringify({ ids: [target!.id], status: 'retire', reason: 'Trop proche d’une carte existante' }),
    });
    expect(refused.status).toBe(200);

    const mine = (await (
      await fetch(`${base}/api/profiles/me/boum-proposals`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { proposals: { text: string; state: string; reason: string | null }[] };
    const shown = mine.proposals.find((p) => p.text === 'Dompteur de canards');
    expect(shown?.state).toBe('refusee');
    expect(shown?.reason).toBe('Trop proche d’une carte existante');

    const del = await fetch(`${base}/api/profiles/me`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);
    const all = (await (await admin('/boum/entries?status=retire')).json()) as {
      entries: { text: string; authorName: string }[];
    };
    expect(all.entries.find((e) => e.text === 'Dompteur de canards')?.authorName).toBe('Joueur supprimé');
  });
});
