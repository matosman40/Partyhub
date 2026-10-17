import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

let server: PartyServer;
let base: string;

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests',
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('En-têtes de sécurité', () => {
  it('autorise les capteurs et le micro pour ce site seulement', async () => {
    const res = await fetch(`${base}/api/health`);
    const policy = res.headers.get('permissions-policy') ?? '';
    for (const feature of ['accelerometer', 'gyroscope', 'magnetometer', 'microphone', 'camera']) {
      expect(policy).toContain(`${feature}=(self)`);
    }
    // Aucune fonction n'est ouverte à des sites tiers.
    expect(policy).not.toMatch(/=\*/);
  });

  it('garde la politique de contenu et le blocage des cadres étrangers', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
