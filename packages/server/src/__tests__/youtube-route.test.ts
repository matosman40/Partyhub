import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Route de recherche YouTube : sans clé ni réseau, on vérifie les codes de réponse, sans appeler Google. */

const silent = createLogger('silent', true);
const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function configWith(youtubeApiKey: string | undefined): AppConfig {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ph-youtube-route-'));
  roots.push(dataDir);
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: path.join(dataDir, 'partyhub.db'),
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
    youtube: { apiKey: youtubeApiKey },
  };
}

describe('Route de recherche YouTube', () => {
  const started: PartyServer[] = [];
  afterEach(async () => {
    for (const s of started.splice(0)) await s.close().catch(() => undefined);
  });

  async function boot(youtubeApiKey: string | undefined): Promise<string> {
    const server = await createServer({ config: configWith(youtubeApiKey), logger: silent, sweepEveryMs: 0 });
    started.push(server);
    const port = await server.listen(0, '127.0.0.1');
    return `http://127.0.0.1:${port}`;
  }

  it('refuse une requête trop courte avec un message en français', async () => {
    const base = await boot(undefined);
    const response = await fetch(`${base}/api/youtube/search?q=a`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('au moins deux caractères');
  });

  it('sans clé, répond 503 : la recherche est désactivée, le lien reste possible', async () => {
    const base = await boot(undefined);
    const response = await fetch(`${base}/api/youtube/search?q=stromae`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Collez un lien YouTube');
    expect(JSON.stringify(body)).not.toContain('key=');
  });

  it('une clé vide compte comme absente', async () => {
    const base = await boot('   ');
    const response = await fetch(`${base}/api/youtube/search?q=stromae`);
    expect(response.status).toBe(503);
  });
});
