import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createServer, type PartyServer } from '../server.js';

/** Routes des réglages du serveur, sur un vrai serveur : session administrateur, validation, redémarrage. */

const silent = createLogger('silent', true);
const PASSWORD = 'test-password-123';
const FILE_TOKEN = 'ghp_jeton_du_fichier_env';
const roots: string[] = [];
const started: PartyServer[] = [];

afterAll(async () => {
  for (const server of started) await server.close();
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

async function boot(onRestart: () => void) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ph-reglages-routes-'));
  roots.push(dataDir);
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: path.join(dataDir, 'partyhub.db'),
    staticDir: '/nonexistent',
    adminPassword: PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
  };
  const server = await createServer({
    config,
    logger: silent,
    sweepEveryMs: 0,
    bootEnv: { GITHUB_TOKEN: FILE_TOKEN, LOG_FILES: '6' },
    bootOverrides: {},
    onRestart,
  });
  started.push(server);
  const port = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}/api/admin`;
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { base, cookie };
}

describe('routes des réglages du serveur', () => {
  it('refuse l’accès sans session administrateur', async () => {
    const { base } = await boot(() => {});
    const res = await fetch(`${base}/server-settings`);
    expect(res.status).toBe(401);
  });

  it('liste les réglages sans jamais renvoyer la valeur d’un secret', async () => {
    const { base, cookie } = await boot(() => {});
    const res = await fetch(`${base}/server-settings`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FILE_TOKEN);
    const body = JSON.parse(text) as {
      settings: { env: string; source: string; value: unknown; configured: boolean }[];
    };
    expect(body.settings.find((s) => s.env === 'GITHUB_TOKEN')).toMatchObject({
      value: null,
      configured: true,
      source: 'fichier',
    });
    expect(body.settings.find((s) => s.env === 'LOG_FILES')).toMatchObject({ value: '6', source: 'fichier' });
  });

  it('refuse une valeur mal formée, puis enregistre une valeur correcte et signale le redémarrage', async () => {
    const { base, cookie } = await boot(() => {});
    const bad = await fetch(`${base}/server-settings/LOG_FILES`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ value: '0' }),
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${base}/server-settings/LOG_FILES`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ value: '4' }),
    });
    expect(good.status).toBe(200);
    const after = (await good.json()) as { pendingRestart: boolean; settings: { env: string; value: string }[] };
    expect(after.pendingRestart).toBe(true);
    expect(after.settings.find((s) => s.env === 'LOG_FILES')?.value).toBe('4');
  });

  it('refuse un réglage inconnu', async () => {
    const { base, cookie } = await boot(() => {});
    const res = await fetch(`${base}/server-settings/INCONNU`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ value: '1' }),
    });
    expect(res.status).toBe(404);
  });

  it('accepte le redémarrage demandé, et le confie au conteneur après la réponse', async () => {
    vi.useRealTimers();
    const onRestart = vi.fn();
    const { base, cookie } = await boot(onRestart);
    const res = await fetch(`${base}/server-settings/restart`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(202);
    expect(onRestart).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
