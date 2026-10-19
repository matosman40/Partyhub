import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Routes d’administration de la mise à jour, avec une vraie session et une fausse liste GitHub. */

const PASSWORD = 'update-password-123';
const RELEASES = [
  {
    tag_name: 'v0.13.0',
    name: 'PartyHub 0.13.0',
    published_at: '2026-10-18T10:00:00Z',
    body: 'Karaoké amélioré',
    html_url: 'https://github.com/x/y/releases/tag/v0.13.0',
    draft: false,
    prerelease: false,
  },
  {
    tag_name: 'v0.12.0',
    name: 'PartyHub 0.12.0',
    published_at: '2026-10-01T10:00:00Z',
    body: 'Version précédente',
    html_url: 'https://github.com/x/y/releases/tag/v0.12.0',
    draft: false,
    prerelease: false,
  },
];

let dir: string;
let server: PartyServer;
let base: string;
let cookie: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-update-admin-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
    backup: { dir: path.join(dir, 'backups'), everyMs: 0, keep: 3 },
  };
  const fetchImpl = (async () =>
    new Response(JSON.stringify(RELEASES), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  server = await createServer({
    config,
    logger: createLogger('silent', true),
    sweepEveryMs: 0,
    update: { fetch: fetchImpl, repo: 'x/y', version: '0.12.0' },
  });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function admin(route: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}/api/admin/update${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie },
  });
}

describe('Mise à jour depuis l’administration', () => {
  it('sans session d’administration, l’état est refusé', async () => {
    const res = await fetch(`${base}/api/admin/update`);
    expect(res.status).toBe(401);
  });

  it('donne la version en cours et les versions publiées, avec leur changelog', async () => {
    const res = await admin('');
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      current: string;
      releases: { version: string; notes: string; newer: boolean }[];
      updater: { installed: boolean };
      canUpdate: boolean;
      blockedReason: string | null;
    };
    expect(view.current).toBe('0.12.0');
    expect(view.releases.map((r) => r.version)).toEqual(['0.13.0', '0.12.0']);
    expect(view.releases[0]).toMatchObject({ newer: true, notes: 'Karaoké amélioré' });
    expect(view.releases[1]?.newer).toBe(false);
    expect(view.updater.installed).toBe(false);
    expect(view.canUpdate).toBe(false);
    expect(view.blockedReason).toContain('installeur');
  });

  it('refuse une demande sans installeur, et un numéro de version mal formé', async () => {
    const invalid = await admin('', { method: 'POST', body: JSON.stringify({ version: 'pas-une-version' }) });
    expect(invalid.status).toBe(400);
    const absent = await admin('', { method: 'POST', body: JSON.stringify({ version: '0.13.0' }) });
    expect(absent.status).toBe(409);
  });

  it('avec l’installeur présent : demande acceptée après sauvegarde, visible, puis annulable', async () => {
    fs.mkdirSync(path.join(dir, 'update'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'update', 'updater-heartbeat.json'),
      JSON.stringify({ seenAt: new Date().toISOString() }),
    );

    const sent = await admin('', { method: 'POST', body: JSON.stringify({ version: '0.13.0' }) });
    expect(sent.status).toBe(202);
    expect(fs.readdirSync(path.join(dir, 'backups')).length).toBe(1);

    const during = (await (await admin('')).json()) as { pending: { version: string } | null; blockedReason: string };
    expect(during.pending?.version).toBe('0.13.0');
    expect(during.blockedReason).toContain('déjà demandée');

    const cancelled = await admin('', { method: 'DELETE' });
    expect(cancelled.status).toBe(200);
    const after = (await (await admin('')).json()) as { pending: unknown };
    expect(after.pending).toBeNull();
  });
});
